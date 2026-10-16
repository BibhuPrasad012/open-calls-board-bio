// ─────────────────────────────────────────────────────────────
// Step 1: paste your Firebase web app settings here.
// Firebase console → Project settings → General → Your apps → SDK setup and configuration → Config.
// These values are not secret; your data is protected by firestore.rules.
// ─────────────────────────────────────────────────────────────
export const firebaseConfig = {
  apiKey: "AIzaSyARq_ke_N6kEv_vRzwvSbZ82IsxKNndN1Q",
  authDomain: "open-calls-board-bio.firebaseapp.com",
  projectId: "open-calls-board-bio",
  storageBucket: "open-calls-board-bio.firebasestorage.app",
  messagingSenderId: "722204295804",
  appId: "1:722204295804:web:6ad9440057b2110a0b7ff9",
  measurementId: "G-F8EV3THGHR"
};

// ─────────────────────────────────────────────────────────────
// Step 2: who can sign in, and who the admins are.
// Only accounts with an email at this domain can sign in.
// The same domain is checked in firestore.rules (isMember function).
// ─────────────────────────────────────────────────────────────
export const ALLOWED_EMAIL_DOMAIN = "iitgn.ac.in";

// Admins can load the starter list and delete anyone's positions.
// Use IITGN addresses, and list the same ones in firestore.rules (adminEmails function).
export const ADMIN_EMAILS = [
  "bibhu.sahoo@iitgn.ac.in"
];
