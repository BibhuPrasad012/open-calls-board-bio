# Open calls in bio & engineering

A shared board of scholarships, fellowships and funded PhD positions. Visitors can browse without an account. Only people with an **IIT Gandhinagar email (@iitgn.ac.in)** can sign in, and once signed in they can save positions to a private wishlist, track their progress, get deadline reminders, and add or edit positions for everyone.

The site is plain HTML and JavaScript, hosted free on **GitHub Pages**. The shared data (positions, wishlists) lives in a free **Firebase** project, because GitHub Pages can only serve files and can't store anything people save.

## What's in this folder

| File | What it does |
|---|---|
| `index.html` | The page layout and styles |
| `app.js` | Everything the page does |
| `config.js` | **You edit this:** your Firebase settings, the allowed email domain and the admin email |
| `firestore.rules` | **You edit this:** security rules you paste into Firebase |
| `starter-positions.json` | The 51 starter programmes, loaded once by an admin |

## Setup (about 15 minutes)

### Part A: Firebase (the database and sign-in)

1. **Create a project.** Go to <https://console.firebase.google.com>, select **Create a project**, give it a name, and finish the wizard. Google Analytics is optional; you can turn it off.

2. **Turn on Google sign-in.** In the left menu open **Build → Authentication**, select **Get started**, then on the **Sign-in method** tab choose **Google**, switch it on, pick a support email, and save.

3. **Create the database.** Open **Build → Firestore Database**, select **Create database**, choose a location near your users, and start in **production mode**.

4. **Add the security rules.** Open `firestore.rules` in this folder and replace `you@iitgn.ac.in` with your own IITGN email (lowercase). In Firestore, open the **Rules** tab, delete what's there, paste the whole file, and select **Publish**.

5. **Get your web settings.** Select the gear icon → **Project settings**. Under **Your apps**, select the web icon (`</>`), give the app a nickname, and register it (you don't need Firebase Hosting). Copy the values from the `firebaseConfig` block it shows into `config.js`, and put your IITGN email in `ADMIN_EMAILS` there too.

### Part B: GitHub Pages (the website)

6. **Upload the files.** Create a new **public** repository on GitHub. Select **Add file → Upload files**, drag in every file from this folder (including your edited `config.js`), and commit.

7. **Turn on Pages.** In the repository go to **Settings → Pages**. Under **Build and deployment**, set **Source** to **Deploy from a branch**, choose `main` and `/ (root)`, and save. After a minute or two your site is live at `https://YOUR-USERNAME.github.io/REPOSITORY-NAME/`.

8. **Allow sign-in from your site.** Back in Firebase, open **Authentication → Settings → Authorized domains**, select **Add domain**, and enter `YOUR-USERNAME.github.io` (no `https://`, no path).

9. **Load the starter list.** Open your site, select **Sign in with your IITGN email** using your admin account, and select **Load the starter list**. The 51 programmes appear for everyone.

## Good to know

**Cost.** Firebase's free Spark plan covers 50,000 reads and 20,000 writes per day. Each visit reads every position once, so with about 50 positions the board handles roughly 900 visits a day for free. If you outgrow that, Firebase shows usage under **Usage and billing**.

**Who can sign in.** Sign-in is limited to `@iitgn.ac.in` addresses in two places. The page asks Google to show only IITGN accounts and immediately signs out anyone who picks another email. The security rules in `firestore.rules` also refuse every save from a non-IITGN account, so the restriction holds even if someone bypasses the page. To change the domain, edit `ALLOWED_EMAIL_DOMAIN` in `config.js` and the pattern in the `isMember` function of `firestore.rules`, then publish the rules again.

**Your Firebase settings are not secret.** The values in `config.js` are meant to be public. What protects the data is `firestore.rules`: anyone can read positions, only signed-in IITGN members can add or edit them, only the person who added a position (or an admin) can delete it, and each person's wishlist and notes can be read only by them.

**Names shown publicly.** When someone adds or edits a position, their first name (from their Google account) is shown with it.

**Reminders.** The site shows a reminder panel for wishlist deadlines whenever you open it. For phone alerts, go to **My wishlist → Download calendar with reminders (.ics)**. Opening that file adds each deadline to your calendar, with alerts on the morning of the day you choose (3, 7, 14 or 30 days before) and the day before. Each position also has Google Calendar and Outlook links.

**Changing the admin.** Edit the email in both `config.js` and `firestore.rules` (then publish the rules again). Admins must use IITGN emails too.

**Trying it on your own computer.** Browsers block this kind of page when opened straight from a file. In this folder run `python3 -m http.server 8000` and open <http://localhost:8000>. `localhost` is already an authorized domain in Firebase.

**Updating the site.** Edit a file on GitHub (or upload a new version). Pages republishes automatically within a minute or two. Positions and wishlists live in Firebase, so updating the files never erases them.
