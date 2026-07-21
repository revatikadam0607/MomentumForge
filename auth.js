/* =========================================================
   MOMENTUMFORGE — AUTHENTICATION
   Firebase Authentication (compat SDK — plain <script> tags,
   no bundler, matching the rest of this project). Handles:
     - Google Sign-In
     - Email/password sign up + log in
     - "Remember Me" (Firebase session persistence)
     - Gating the app behind a signed-in user
     - Scoping each user's saved tasks to their own account
   See FIREBASE_SETUP.md for the one-time project setup this
   depends on.
========================================================= */

"use strict";

let firebaseApp = null;
let auth = null;
let currentUser = null;
let appHasStarted = false; // guards against calling init() more than once

/* ---------------------------------------------------------
   INIT
--------------------------------------------------------- */
function initFirebase(){
  // Theme is a UI preference, not account-specific — apply it immediately
  // so the login screen itself respects dark/light mode too, instead of
  // waiting until after sign-in (when init() would otherwise call this).
  initTheme();

  if(!window.firebase){
    showAuthError("Firebase SDK failed to load. Check your internet connection and reload.");
    return;
  }
  if(firebaseConfig.apiKey === "YOUR_API_KEY"){
    showAuthSetupNotice();
    return;
  }

  firebaseApp = firebase.initializeApp(firebaseConfig);
  auth = firebase.auth();

  auth.onAuthStateChanged(handleAuthStateChanged);

  wireAuthForm();
}

/**
 * Single source of truth for "are we logged in". Fires on load
 * (if a remembered session exists), after a successful login/
 * signup, and after sign-out.
 */
async function handleAuthStateChanged(user){
  if(user){
    currentUser = user;
    await migrateLegacyDataIfNeeded(user.uid);
    scopeStorageToUser(user.uid);
    hideAuthOverlay();
    renderUserMenu(user);

    if(!appHasStarted){
      appHasStarted = true;
      window.startMomentumForgeApp(); // defined in script.js
    }
  } else {
    currentUser = null;
    appHasStarted = false;
    showAuthOverlay();
  }
}

/**
 * Points the app's existing localStorage persistence at a
 * per-user key, so two different accounts on the same browser
 * never see each other's tasks/notes/streaks.
 *
 * NOTE: this reassigns the same `STORAGE_KEY` variable declared
 * with `let` in script.js — classic (non-module) <script> tags
 * share one global scope, so this works as long as script.js has
 * already loaded (it's included before auth.js in index.html).
 * `window.STORAGE_KEY = ...` would NOT work here since `let`/`const`
 * globals aren't attached to `window` the way `var` is.
 */
function scopeStorageToUser(uid){
  STORAGE_KEY = `momentumForgeState_v1_${uid}`;
}

/**
 * If this browser has pre-login data saved under the old,
 * un-scoped key (from testing before auth existed), copy it
 * into this user's own key the first time they sign in — so
 * nobody loses progress just because login got added later.
 */
async function migrateLegacyDataIfNeeded(uid){
  const scopedKey = `momentumForgeState_v1_${uid}`;
  const legacyKey = "momentumForgeState_v1";
  try{
    if(!localStorage.getItem(scopedKey) && localStorage.getItem(legacyKey)){
      localStorage.setItem(scopedKey, localStorage.getItem(legacyKey));
    }
  }catch(e){ console.warn("Legacy data migration skipped:", e); }
}

/* ---------------------------------------------------------
   OVERLAY VISIBILITY
--------------------------------------------------------- */
function showAuthOverlay(){
  document.getElementById("authOverlay").classList.add("open");
  document.body.classList.add("app-locked");
}
function hideAuthOverlay(){
  document.getElementById("authOverlay").classList.remove("open");
  document.body.classList.remove("app-locked");
}

function showAuthSetupNotice(){
  const box = document.getElementById("authErrorBox");
  box.hidden = false;
  box.innerHTML = `<strong>Firebase isn't configured yet.</strong> Open <code>firebase-config.js</code> and fill in your project's values — see <code>FIREBASE_SETUP.md</code> for step-by-step instructions.`;
  document.getElementById("authOverlay").classList.add("open");
  document.body.classList.add("app-locked");
}

function showAuthError(message){
  const box = document.getElementById("authErrorBox");
  box.hidden = false;
  box.textContent = message;
}
function clearAuthError(){
  const box = document.getElementById("authErrorBox");
  box.hidden = true;
  box.textContent = "";
}

/* ---------------------------------------------------------
   FRIENDLY ERROR MESSAGES
--------------------------------------------------------- */
function friendlyAuthError(err){
  const map = {
    "auth/email-already-in-use": "That email already has an account — try logging in instead.",
    "auth/invalid-email": "That doesn't look like a valid email address.",
    "auth/weak-password": "Password should be at least 6 characters.",
    "auth/user-not-found": "No account found with that email.",
    "auth/wrong-password": "Incorrect password. Try again.",
    "auth/invalid-credential": "Incorrect email or password.",
    "auth/too-many-requests": "Too many attempts — please wait a moment and try again.",
    "auth/network-request-failed": "Network error — check your connection and try again.",
    "auth/unauthorized-domain": "This domain isn't authorized for Google Sign-In yet. Add it under Firebase Console → Authentication → Settings → Authorized domains.",
    "auth/popup-closed-by-user": null, // not a real error — user just closed the popup
  };
  if(err.code === "auth/popup-closed-by-user") return null;
  return map[err.code] || err.message || "Something went wrong — please try again.";
}

/* ---------------------------------------------------------
   FORM WIRING
--------------------------------------------------------- */
let authMode = "login"; // "login" | "signup"

function wireAuthForm(){
  const form = document.getElementById("authForm");
  const modeToggle = document.getElementById("authModeToggle");
  const nameField = document.getElementById("authNameField");
  const submitBtn = document.getElementById("authSubmitBtn");
  const title = document.getElementById("authTitle");
  const googleBtn = document.getElementById("googleSignInBtn");

  function setMode(mode){
    authMode = mode;
    clearAuthError();
    if(mode === "signup"){
      nameField.hidden = false;
      submitBtn.textContent = "Create Account";
      title.textContent = "Create your account";
      modeToggle.innerHTML = `Already have an account? <button type="button" id="authModeBtn">Log in</button>`;
    } else {
      nameField.hidden = true;
      submitBtn.textContent = "Log In";
      title.textContent = "Welcome back";
      modeToggle.innerHTML = `Don't have an account? <button type="button" id="authModeBtn">Sign up</button>`;
    }
    document.getElementById("authModeBtn").addEventListener("click", ()=> setMode(mode === "signup" ? "login" : "signup"));
  }
  setMode("login");

  form.addEventListener("submit", async (e)=>{
    e.preventDefault();
    clearAuthError();

    const email = document.getElementById("authEmail").value.trim();
    const password = document.getElementById("authPassword").value;
    const name = document.getElementById("authName").value.trim();
    const rememberMe = document.getElementById("authRememberMe").checked;

    submitBtn.disabled = true;
    submitBtn.textContent = authMode === "signup" ? "Creating account…" : "Logging in…";

    try{
      await auth.setPersistence(rememberMe ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);

      if(authMode === "signup"){
        const cred = await auth.createUserWithEmailAndPassword(email, password);
        if(name) await cred.user.updateProfile({ displayName: name });
      } else {
        await auth.signInWithEmailAndPassword(email, password);
      }
      // onAuthStateChanged picks up from here
    }catch(err){
      const msg = friendlyAuthError(err);
      if(msg) showAuthError(msg);
      submitBtn.disabled = false;
      submitBtn.textContent = authMode === "signup" ? "Create Account" : "Log In";
    }
  });

  googleBtn.addEventListener("click", async ()=>{
    clearAuthError();
    const rememberMe = document.getElementById("authRememberMe").checked;
    googleBtn.disabled = true;
    try{
      await auth.setPersistence(rememberMe ? firebase.auth.Auth.Persistence.LOCAL : firebase.auth.Auth.Persistence.SESSION);
      const provider = new firebase.auth.GoogleAuthProvider();
      await auth.signInWithPopup(provider);
    }catch(err){
      const msg = friendlyAuthError(err);
      if(msg) showAuthError(msg);
    }
    googleBtn.disabled = false;
  });
}

/* ---------------------------------------------------------
   USER MENU (navbar)
--------------------------------------------------------- */
function renderUserMenu(user){
  const wrap = document.getElementById("userMenuWrap");
  const initial = (user.displayName || user.email || "?").trim().charAt(0).toUpperCase();
  const label = user.displayName || user.email;

  wrap.innerHTML = `
    <button class="user-avatar-btn" id="userAvatarBtn" aria-label="Account menu" title="${escapeHtmlAttr(label)}">${initial}</button>
    <div class="user-menu-dropdown" id="userMenuDropdown">
      <div class="user-menu-email">${escapeHtmlAttr(label)}</div>
      <button class="user-menu-signout" id="signOutBtn">Sign Out</button>
    </div>
  `;

  const avatarBtn = document.getElementById("userAvatarBtn");
  const dropdown = document.getElementById("userMenuDropdown");
  avatarBtn.addEventListener("click", (e)=>{
    e.stopPropagation();
    dropdown.classList.toggle("open");
  });
  document.addEventListener("click", ()=> dropdown.classList.remove("open"));

  document.getElementById("signOutBtn").addEventListener("click", async ()=>{
    // A full reload after sign-out (rather than trying to "reset" in place)
    // is deliberate: init() attaches dozens of event listeners across the
    // app on the assumption it only ever runs once per page load. Signing
    // in as a second person without reloading would re-run init() and
    // double up every listener in the app. Reloading guarantees each
    // sign-in starts from a clean slate.
    await auth.signOut();
    location.reload();
  });
}

function escapeHtmlAttr(str){
  const div = document.createElement("div");
  div.textContent = str ?? "";
  return div.innerHTML;
}

document.addEventListener("DOMContentLoaded", initFirebase);