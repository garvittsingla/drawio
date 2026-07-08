/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;

// Monkey-patch DriveClient to work on static hosting (no Java backend).
//
// Background: app.min.js's authorizeStep2() has two branches:
//   1. immediate=true  + userId!=null  → XHR to /google?state=...&userId=... (server token refresh) ← FAILS
//   2. immediate=false                 → OAuth popup, response_type=token (already works!)
// When branch 1 gets a 404 it calls logout(), which XHRs /google?doLogout=1  ← ALSO FAILS
//
// Fix: override authorizeStep2 so that when immediate=true, it always calls error()
// immediately (no server round-trip). Also override logout() to clear state locally.
(function()
{
	if (typeof window.DriveClient === 'function')
	{
		var originalAuthorizeStep2 = DriveClient.prototype.authorizeStep2;
		var originalUpdateAuthInfo = DriveClient.prototype.updateAuthInfo;
		var originalSetPersistentToken = DriveClient.prototype.setPersistentToken;

		// Override authorizeStep2: skip the server-side token-refresh XHR when immediate=true.
		// Instead, check our locally-stored access_token; if still valid use it,
		// otherwise fail immediately so the app shows the sign-in dialog.
		DriveClient.prototype.authorizeStep2 = function(localState, immediate, success, error, remember, popup)
		{
			if (immediate)
			{
				// Try to reuse a locally cached, non-expired token.
				try
				{
					var stored = JSON.parse(this.getPersistentToken(true));
					if (stored && stored.current &&
					    stored.current.access_token &&
					    stored.current.expires > Date.now() + 60000)
					{
						var tok = stored.current;
						var authInfo = {
							access_token: tok.access_token,
							expires_in: Math.round((tok.expires - Date.now()) / 1000),
							remember: tok.remember
						};
						this.updateAuthInfo(authInfo, tok.remember, false, success, error);
						return;
					}
				}
				catch (e) {}

				// No valid cached token → fail immediately (no server call).
				if (error != null) { error(); }
				return;
			}

			// For non-immediate (interactive), delegate to the original so the
			// OAuth popup opens normally with response_type=token → google.html.
			originalAuthorizeStep2.call(this, localState, immediate, success, error, remember, popup);
		};

		// Override logout: original navigates (via XHR/loadUrl) to /google?doLogout=1
		// which 404s on static hosting. Just clear state locally instead.
		DriveClient.prototype.logout = function()
		{
			this.clearPersistentToken();
			this.setUser(null);
		};

		// Override updateAuthInfo to preserve the access_token so we can re-read
		// it from localStorage on the next page load (the original deletes it).
		DriveClient.prototype.updateAuthInfo = function(newAuthInfo, remember, forceUserUpdate, success, error)
		{
			// Keep a reference to the raw token before the original deletes it.
			this.currentAccessToken = newAuthInfo.access_token;

			var copy = Object.assign({}, newAuthInfo);
			originalUpdateAuthInfo.call(this, copy, remember, forceUserUpdate, success, error);
		};

		// Override setPersistentToken to re-inject the access_token that the
		// original updateAuthInfo deleted (so it survives page reloads).
		DriveClient.prototype.setPersistentToken = function(userAuthInfo, sessionOnly)
		{
			if (this.currentAccessToken && userAuthInfo)
			{
				userAuthInfo.access_token = this.currentAccessToken;
			}
			originalSetPersistentToken.call(this, userAuthInfo, sessionOnly);
		};
	}
})();
