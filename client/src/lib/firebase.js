import { initializeApp } from "firebase/app";
import { 
  getAuth, 
  GoogleAuthProvider, 
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail
} from "firebase/auth";

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebaseapp.com`,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: `${import.meta.env.VITE_FIREBASE_PROJECT_ID}.firebasestorage.app`,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);
const googleProvider = new GoogleAuthProvider();

// Telegram WebView blocks popups — detect it and use redirect instead
function isTelegramWebView() {
  if (typeof window === 'undefined') return false;
  return Boolean(
    window.Telegram?.WebApp?.initData ||
    window.TelegramWebviewProxy ||
    /TelegramWebView/i.test(navigator.userAgent)
  );
}

function buildGoogleResult(user, idToken) {
  return {
    success: true,
    idToken,
    user: {
      email: user.email,
      displayName: user.displayName,
      photoURL: user.photoURL,
      uid: user.uid,
    },
  };
}

export async function signInWithGoogle() {
  try {
    if (isTelegramWebView()) {
      // Telegram blocks signInWithPopup — use redirect flow instead
      // The result is picked up by handleGoogleRedirectResult() on page load
      await signInWithRedirect(auth, googleProvider);
      return { success: false, redirecting: true };
    }
    const result = await signInWithPopup(auth, googleProvider);
    const idToken = await result.user.getIdToken();
    return buildGoogleResult(result.user, idToken);
  } catch (error) {
    console.error("Google sign-in error:", error);
    return {
      success: false,
      error: error.code === 'auth/popup-closed-by-user'
        ? 'Sign-in cancelled'
        : error.message,
    };
  }
}

// Call this on page mount to handle the result of signInWithRedirect
export async function handleGoogleRedirectResult() {
  try {
    const result = await getRedirectResult(auth);
    if (!result) return null; // No pending redirect
    const idToken = await result.user.getIdToken();
    return buildGoogleResult(result.user, idToken);
  } catch (error) {
    console.error("Google redirect result error:", error);
    return { success: false, error: error.message };
  }
}

export async function signUpWithEmail(email, password, displayName) {
  try {
    const result = await createUserWithEmailAndPassword(auth, email, password);
    
    // Get the Firebase ID token to send to our backend
    const idToken = await result.user.getIdToken();
    
    return {
      success: true,
      idToken,
      user: {
        email: result.user.email,
        displayName: displayName || email.split('@')[0],
        uid: result.user.uid,
        emailVerified: result.user.emailVerified,
      },
    };
  } catch (error) {
    console.error("Email signup error:", error);
    let errorMessage = 'Signup failed';
    
    switch (error.code) {
      case 'auth/email-already-in-use':
        errorMessage = 'This email is already registered. Try logging in instead.';
        break;
      case 'auth/invalid-email':
        errorMessage = 'Invalid email address';
        break;
      case 'auth/weak-password':
        errorMessage = 'Password should be at least 6 characters';
        break;
      default:
        errorMessage = error.message;
    }
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function signInWithEmail(email, password) {
  try {
    const result = await signInWithEmailAndPassword(auth, email, password);
    
    if (!result.user.emailVerified) {
      await sendEmailVerification(result.user);
      return {
        success: false,
        requiresVerification: true,
        error: 'Please verify your email first. A new verification email has been sent.',
      };
    }
    
    const idToken = await result.user.getIdToken();
    
    return {
      success: true,
      idToken,
      user: {
        email: result.user.email,
        displayName: result.user.displayName,
        uid: result.user.uid,
        emailVerified: result.user.emailVerified,
      },
    };
  } catch (error) {
    console.error("Email sign-in error:", error);
    let errorMessage = 'Login failed';
    
    switch (error.code) {
      case 'auth/user-not-found':
      case 'auth/wrong-password':
      case 'auth/invalid-credential':
        errorMessage = 'Invalid email or password';
        break;
      case 'auth/too-many-requests':
        errorMessage = 'Too many failed attempts. Please try again later.';
        break;
      default:
        errorMessage = error.message;
    }
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function resetPassword(email) {
  try {
    await sendPasswordResetEmail(auth, email);
    return {
      success: true,
      message: 'Password reset email sent! Check your inbox.',
    };
  } catch (error) {
    console.error("Password reset error:", error);
    let errorMessage = 'Failed to send reset email';
    
    switch (error.code) {
      case 'auth/user-not-found':
        errorMessage = 'No account found with this email';
        break;
      case 'auth/invalid-email':
        errorMessage = 'Invalid email address';
        break;
      default:
        errorMessage = error.message;
    }
    
    return {
      success: false,
      error: errorMessage,
    };
  }
}

export async function checkEmailVerified() {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: 'No user signed in' };
    }
    
    await user.reload();
    
    if (user.emailVerified) {
      const idToken = await user.getIdToken();
      return {
        success: true,
        verified: true,
        idToken,
        user: {
          email: user.email,
          displayName: user.displayName,
          uid: user.uid,
        },
      };
    }
    
    return { success: true, verified: false };
  } catch (error) {
    console.error("Check verification error:", error);
    return { success: false, error: error.message };
  }
}

export async function resendVerificationEmail() {
  try {
    const user = auth.currentUser;
    if (!user) {
      return { success: false, error: 'No user signed in' };
    }
    
    await sendEmailVerification(user);
    return { success: true, message: 'Verification email sent!' };
  } catch (error) {
    console.error("Resend verification error:", error);
    return { success: false, error: error.message };
  }
}

export { auth };
