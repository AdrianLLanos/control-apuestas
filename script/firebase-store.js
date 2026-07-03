const deployModuleToken = new URL(import.meta.url).searchParams.get("deploy") ||
  new URL(import.meta.url).searchParams.get("v") ||
  Date.now().toString(36);
const withDeployToken = (path) =>
  `${path}${path.includes("?") ? "&" : "?"}deploy=${encodeURIComponent(deployModuleToken)}`;

const { db } = await import(withDeployToken("../firebase.js"));

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
