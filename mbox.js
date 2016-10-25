const {EventEmitter} = require('events')

const EOF = new Error('Empty Read')


class Mbox extends EventEmitter {
	constructor(file, fs) {
		super()
		if (!fs) fs = require('fs')
		this.fs = fs
		this.lineend = '\n'
		this.blockSize = 4096
		this.index = []
		this.done = false

		this.on('message', message=>this.index.push(message))
		this.on('end', ()=>this.done = true)

		if (typeof file === 'number') {
			setImmediate(()=>this.checkMagic())
		} else {
			this.open(file)
		}
	}
	open(file) {
		this.fs.open(file, 'r', (err, fd)=>{
			this.fd = fd
			if (err) this.emit('err', err)
			else this.checkMagic()
		})
	}
	readMessage(i, cb) {
		let msg = this.index[i]
		let length = msg.headerLength + msg.contentLength
		let buffer = Buffer.alloc(length)
		this.fs.read(this.fd, buffer, 0, length, msg.pos, (err,count,data)=>{
			if (err) this.emit('err', err)
			else if (count !== length) this.emit('err', new Error(`Read ${count} bytes instead of ${length}.`))
			else cb(data)
		})
	}
	read(pos, cb) {
		let buffer = Buffer.alloc(this.blockSize)
		this.fs.read(this.fd, buffer, 0, this.blockSize, pos, cb)
	}

	parseHeaders(buffer) {
		const headerString = buffer.toString()
		const headerLines  = headerString.split(this.lineend)
		const headers = headerLines.reduce( (acc, cur)=>{
			if (cur.startsWith(' ') || cur.startsWith('\t')) {
				acc[acc.length - 1] = acc[acc.length - 1] + cur
			} else {
				acc.push(cur)
			}
			return acc
		}, [])

		const parsedHeaders = headers.reduce( (acc, cur)=>{
			let [name, ...value] = cur.split(':')
			value = value.join(':')

			if (name.startsWith('From ')) {
				name = "Envelope-From"
				value = cur.slice(5)
			}

			if (name in acc) {
				acc[name] = [].concat(acc[name], value)
			} else {
				acc[name] = value
			}
			return acc
		}, {})

		return parsedHeaders
	}
	analyzeMessage(headers, cb) {
		if (headers.length === 0) {
			return this.emit('end')
		}

		let parsedHeaders = this.parseHeaders(headers)
		let contentLength = +parsedHeaders['Content-Length']

		let messageData = {
			pos: this.readPos,
			headers: parsedHeaders,
			headerLength: headers.length,
			contentLength,
			length: headers.length + contentLength + 3
		}


		if (isNaN(contentLength)) {
			this.readPos += headers.length
			this.findNextMessageStart(this.readPos, pos=>{
				contentLength = pos - this.readPos
				messageData.contentLength = contentLength
				messageData.length = headers.length + contentLength
				this.readPos = pos
				cb(messageData)
			})
		} else {
			this.readPos += messageData.length
			cb(messageData)
		}
	}
	findNextMessageStart(pos, cb) {
		let needle = Buffer.from(this.lineend + "From ")
		this.read(pos, (err, bytesRead, buffer)=>{
			let p = buffer.indexOf(needle)
			if (p === -1) {
				this.findNextMessageStart(pos+bytesRead - needle.length, cb)
			} else {
				cb(pos + p + this.lineend.length + 1)
			}
		})
	}
	readMbox() {
		this.readPos = 0

		let next = (err, headers)=>{
			if (err) return this.emit(err)
			this.analyzeMessage(headers, message=>{
				if (message.pos === 0 && message.headers.From.startsWith(' Mail System Internal Data')) {
					this.emit('log', "Skipping Folder Internal Data")
				} else {
					this.emit('message', message)
				}
				this.readHeaders(this.readPos, next)
			})
		}

		this.readHeaders(this.readPos, next)
	}
	checkMagic() {
		this.read(0, (err, len, data)=>{
			this.emit('log','checking magic')
			if (err) return this.emit('err', err)
			if (!data.slice(0,5).equals(Buffer.from('From ')))
				return this.emit('err', new Error('Not an mbox file'))

			this.emit('log','looks legit')

			if (data.indexOf('\r') > 0) this.lineend = '\r\n'

			this.readMbox()
		})
	}

	readHeaders(pos, cb) {
		let buffers = []
		let lastBuffer = Buffer.alloc(0)
		const needle = Buffer.from(this.lineend + this.lineend)

		const readComplete = (err, bytesRead, buffer)=>{
			if (err) return cb(err)

			if (bytesRead < this.blockSize) {
				buffers.push(buffer.slice(0, bytesRead))
				cb(null, Buffer.concat(buffers))
			} else {
				let haystack = Buffer.concat([lastBuffer, buffer])
				let npos = haystack.indexOf(needle)
				let offset = lastBuffer.length

				lastBuffer = buffer

				if (npos < 0) {
					buffers.push(buffer)
					pos += buffer.length
					this.read(pos, readComplete)
				} else {
					let sliceLength = npos - offset
					buffers.push(buffer.slice(0, sliceLength))
					cb(null, Buffer.concat(buffers))
				}
			}
		}

		this.read(pos, readComplete)
	}
}

module.exports = Mbox
