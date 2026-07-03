import { db } from "../firebase.js";

export {
  collection,
  addDoc,
  deleteDoc,
  doc,
  onSnapshot,
  getDocs,
  getDoc,
  limit,
  orderBy,
  query,
  setDoc,
  startAfter,
  updateDoc,
  where
} from "https://www.gstatic.com/firebasejs/12.12.1/firebase-firestore.js";

export { db };
