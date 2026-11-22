# Capturing from a Shortcut

An iOS Shortcut can add a task to your Inbox in a few seconds, from the Action Button or a widget, without opening Foyer. It sends the task's title straight to the household, with a capture key that belongs to you. The task reaches every one of your devices at once, with its sticker on your Inbox's newest page, as if you had added it in the app.

## Make a capture key

In Foyer, open the account menu and choose **Shortcuts**, then **Make key**. Foyer shows two things to copy into the Shortcut:

- **The address** to send captures to, `https://foyer.<subdomain>.workers.dev/foyer.capture.v1.CaptureService/Capture` for the household.
- **The key**, shown only this once. Foyer keeps only a hash of it.

Making the key on the iPhone, in the web app in Safari, saves moving it between devices.

Each member has one key. It works only for adding tasks to its member's Inbox, and doesn't expire. It stops working when you replace or remove it, under Shortcuts, or when your email leaves the household's allowlist. Replace it if someone else may have seen it.

A key can make 100 captures a day, counted by UTC, so a key that leaks can't fill your Inbox. After that, Foyer refuses its captures until midnight UTC, with "This key has made 100 captures today. Replace it if you didn't make them." A replaced key starts again at zero, and refused captures don't count.

## Build the Shortcut

In the Shortcuts app on the iPhone, make a new Shortcut, named "Capture" for example, with three actions:

1. **Ask for Input**, with input type **Text** and a prompt such as "Capture".
2. **Get Contents of URL**, with the address. Tap the arrow to show its options:
   - **Method:** POST.
   - **Headers:** one header, `Authorization`, with the value `Bearer `, a space, then the key.
   - **Request Body:** JSON, with one Text field, `title`, set to **Provided Input**.
3. **Show Notification**, showing **Contents of URL**.

Foyer answers `{}` when it added the task. When it refuses a capture, its answer's `message` says why, such as "A title can't be blank.", that the key doesn't work, or that it has made all of today's captures. To show "Added to Inbox" instead of `{}`, put these in place of the third action:

1. **Get Dictionary Value**, getting the value for `message` in **Contents of URL**.
2. **If** the Dictionary Value **has any value**, **Show Notification** with the Dictionary Value; **Otherwise**, **Show Notification** with "Added to Inbox".

## Put it on the Action Button or a widget

- **The Action Button,** on iPhones that have one: in the Settings app, choose **Action Button**, swipe to **Shortcut**, and choose the Shortcut.
- **A widget:** add the Shortcuts widget to the Home Screen or the Lock Screen, and choose the Shortcut in it.

## Offline

The Shortcuts app can't keep a capture to send later. Without a connection, the Shortcut shows an error and the capture isn't saved, so send it again once the iPhone is back online. Sending the same capture twice makes two tasks.

Captures made in the app itself do wait while offline, and are sent once the device connects again.
