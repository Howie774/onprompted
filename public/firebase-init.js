// firebase-init.js

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDki8xrtLgYg70Uz97gF8GAL4HpAsqYqbQ",
  authDomain: "onprompted.firebaseapp.com",
  projectId: "onprompted",
  storageBucket: "onprompted.firebasestorage.app",
  messagingSenderId: "172574580327",
  appId: "1:172574580327:web:1ea355e8c9b16d6c24bec2"
};

// Initialize Firebase using the compat SDKs loaded in index.html
firebase.initializeApp(firebaseConfig);

// Expose helpers globally so app.js can use them
window.firebaseAuth = firebase.auth();
window.firebaseDb = firebase.firestore();
window.firebaseGoogleProvider = new firebase.auth.GoogleAuthProvider();