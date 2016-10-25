# node-mboxcl
Content-Length aware mbox reader

The aim of this code is to produce an index of an mbox file that can be used to quickly read messages at random.
It takes advantage of Content-Length headers to make its way through large mbox files quickly. Messages without
Content-Length headers will force the code to scan for the next "\nFrom ". No provision is made for unquoting
">From " in the message bodies. Message header information is emitted as messages are encountered to allow for
responsive UI design. Streamed input is not supported since an index into a stream is not useful. Conversely,
alternative fs modules can theoretically be provided.

```js
const Mbox = require('mboxcl')

let mbox = new Mbox('filename') // or fd
mbox.on('message', ({pos, headers, headerLength, contentLength, length})=>{})
mbox.on('done', ()=>{
  let messageDataArray = mbox.index
})
mbox.on('err', err=>{})
mbox.on('log', msg=>{})
```
