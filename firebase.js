import { initializeApp } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-app.js";
import { getFirestore } from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

const firebaseConfig = {
  apiKey: "AIzaSyAiGG-lhaW4Snw7AsvdZCjSf4lx4Kb4OPE",
  authDomain: "apuestas-app-94cbf.firebaseapp.com",
  projectId: "apuestas-app-94cbf",
  storageBucket: "apuestas-app-94cbf.firebasestorage.app",
  messagingSenderId: "419171678237",
  appId: "1:419171678237:web:12b2fb6afae2b1c3cc2ef4"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
