import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged, setPersistence, browserLocalPersistence } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyDADYGhixKsS7_IhdMaJvb_sEKJQoOXJF8",
  authDomain: "queue-system-4dec1.firebaseapp.com",
  projectId: "queue-system-4dec1",
  storageBucket: "queue-system-4dec1.firebasestorage.app",
  messagingSenderId: "995478354234",
  appId: "1:995478354234:web:a6bd332375043ff96c3803"
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

setPersistence(auth, browserLocalPersistence);

export { auth, signInWithEmailAndPassword, createUserWithEmailAndPassword, signOut, onAuthStateChanged };