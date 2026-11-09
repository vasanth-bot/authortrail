# AuthorTrail for Chrome / Edge

Records how text in a web editor was written. Only hashes and counts leave your browser.

## Install
1. Open `chrome://extensions` (or `edge://extensions`) and turn on **Developer mode**.
2. Choose **Load unpacked** and select this `browser-extension` folder.

## Use
1. Click the AuthorTrail icon. Enter your server address and the connection code from the Write page, then **Save settings**.
2. Open the page you write in and press **Track this tab**. Tracking lasts until the tab reloads.
3. Write in any text box. A checkpoint is saved every minute and when you switch tabs. The icon badge shows the count.
4. **Open verification** shows the record. The document also appears in your Write page list.

## Limits
- It follows the last text box you edited on the page. Pages with several editors are tracked as one document.
- Editors that draw their own text and do not use normal browser edit events (Google Docs, Word Online and some code editors) may be tracked only partly or not at all. Test yours first.
- Insertions of 20+ characters count as pasted, so long autocomplete or voice dictation can count as pasted.
- It needs no access to your other tabs: it only runs on a tab where you press Track.
