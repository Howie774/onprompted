// Import the functions you need from the SDKs you need
import { initializeApp } from "firebase/app";
// TODO: Add SDKs for Firebase products that you want to use
// https://firebase.google.com/docs/web/setup#available-libraries

// Your web app's Firebase configuration
const firebaseConfig = {
  apiKey: "AIzaSyDki8xrtLgYg70Uz97gF8GAL4HpAsqYqbQ",
  authDomain: "onprompted.firebaseapp.com",
  projectId: "onprompted",
  storageBucket: "onprompted.firebasestorage.app",
  messagingSenderId: "172574580327",
  appId: "1:172574580327:web:1ea355e8c9b16d6c24bec2"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

window.firebaseAuth = firebase.auth();
window.firebaseDb = firebase.firestore();