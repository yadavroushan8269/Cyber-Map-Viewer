# ConnectSnap

GitHub-ready starter for a social website with:

- Permanent 8-character Room ID
- Anonymous Firebase login with a display name
- 24-hour text stories
- Room-ID friend requests
- Accept / Reject requests
- Friends list

## Setup

1. Create a Firebase project.
2. Add a Web App.
3. Enable Authentication -> Anonymous.
4. Create a Firestore database.
5. Copy the Firebase Web App config into `firebase-config.js`.
6. Publish the files to GitHub.
7. Enable GitHub Pages from Settings -> Pages.
8. Open the generated GitHub Pages URL.

## Next module

The UI already reserves the Call & Chat area. The next module should add:

- WebRTC 1-to-1 video/audio calls
- Call signaling
- Realtime text chat
- Photo/video messages
- Temporary Snap messages
- Storage rules
- Block/report and abuse controls

For production, use a proper server-side expiration/cleanup process for stories rather than relying only on the browser timestamp.
