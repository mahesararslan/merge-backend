import { registerAs } from '@nestjs/config';

export default registerAs('firebase', () => ({
  projectId: process.env.FIREBASE_PROJECT_ID,
  privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
  clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
}));

// // Import the functions you need from the SDKs you need
// import { initializeApp } from "firebase/app";
// import { getAnalytics } from "firebase/analytics";
// // TODO: Add SDKs for Firebase products that you want to use
// // https://firebase.google.com/docs/web/setup#available-libraries

// // Your web app's Firebase configuration
// // For Firebase JS SDK v7.20.0 and later, measurementId is optional
// const firebaseConfig = {
//   apiKey: "AIzaSyAC6G0CNC1dGEkEy0-2QefRi_dfbzaeQ04",
//   authDomain: "merge-7b4bf.firebaseapp.com",
//   projectId: "merge-7b4bf",
//   storageBucket: "merge-7b4bf.firebasestorage.app",
//   messagingSenderId: "34731146067",
//   appId: "1:34731146067:web:74a2e74ac35740a9e1bfa6",
//   measurementId: "G-300MS828PW"
// };

// // Initialize Firebase
// const app = initializeApp(firebaseConfig);
// const analytics = getAnalytics(app);