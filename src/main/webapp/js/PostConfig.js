/**
 * Copyright (c) 2006-2024, JGraph Holdings Ltd
 * Copyright (c) 2006-2024, draw.io AG
 */
// null'ing of global vars need to be after init.js
window.ICONSEARCH_PATH = null;

// Monkey-patch DriveClient to work client-side only (implicit OAuth2 flow)
(function() {
	if (window.DriveClient)
	{
		var originalAuthorize = DriveClient.prototype.authorize;
		var originalUpdateAuthInfo = DriveClient.prototype.updateAuthInfo;
		var originalSetPersistentToken = DriveClient.prototype.setPersistentToken;

		// Fix redirectUri to point to google.html (static file) instead of /google (Java servlet)
		DriveClient.prototype.redirectUri = window.location.origin +
			window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/') + 1) +
			'google.html';

		// Override logout: instead of navigating the whole page to /google?doLogout=1
		// (which 404s on static hosting), just clear the token locally.
		DriveClient.prototype.logout = function()
		{
			this.clearPersistentToken();
			this.setUser(null);
		};

		// Override setPersistentToken to preserve access_token
		DriveClient.prototype.setPersistentToken = function(userAuthInfo, sessionOnly)
		{
			if (this.currentAccessToken && userAuthInfo)
			{
				userAuthInfo.access_token = this.currentAccessToken;
			}
			originalSetPersistentToken.call(this, userAuthInfo, sessionOnly);
		};

		// Override updateAuthInfo to keep access_token in memory and skip delete
		DriveClient.prototype.updateAuthInfo = function (newAuthInfo, remember, forceUserUpdate, success, error)
		{
			this.currentAccessToken = newAuthInfo.access_token;
			
			// We pass a copy to originalUpdateAuthInfo so its internal deletion of access_token
			// doesn't affect our persistent storage where we want to keep access_token
			var newAuthInfoCopy = Object.assign({}, newAuthInfo);
			originalUpdateAuthInfo.call(this, newAuthInfoCopy, remember, forceUserUpdate, success, error);
		};

		// Override authorize to use client-side OAuth flow
		DriveClient.prototype.authorize = function(immediate, success, error, remember, popup)
		{
			var self = this;
			
			// 1. Check if we have a valid cached token
			var authInfo = null;
			try
			{
				authInfo = JSON.parse(this.getPersistentToken(true));
			}
			catch(e) {}

			if (authInfo != null && authInfo.current != null && authInfo.current.access_token != null && authInfo.current.expires > Date.now() + 60000)
			{
				var tokenDetails = authInfo.current;
				var newAuthInfo = {
					access_token: tokenDetails.access_token,
					expires_in: Math.round((tokenDetails.expires - Date.now()) / 1000),
					remember: tokenDetails.remember
				};
				this.currentAccessToken = tokenDetails.access_token;
				this.userId = tokenDetails.userId;
				this.user = authInfo[this.userId] ? authInfo[this.userId].user : null;
				
				// Call originalUpdateAuthInfo to set closure _token and set authCalled
				originalUpdateAuthInfo.call(this, newAuthInfo, tokenDetails.remember, false, success, error);
				return;
			}

			// If immediate is true, we cannot show a popup, so we fail immediate auth
			if (immediate)
			{
				if (error != null)
				{
					error();
				}
				return;
			}

			// 2. Perform client-side implicit OAuth flow
			var state = Math.random().toString(36).substring(2);
			var redirectUri = this.redirectUri;
			
			var url = 'https://accounts.google.com/o/oauth2/v2/auth?client_id=' + this.clientId +
					'&redirect_uri=' + encodeURIComponent(redirectUri) + 
					'&response_type=token' + // implicit flow
					'&include_granted_scopes=true' +
					'&scope=' + encodeURIComponent(this.scopes.join(' ')) +
					'&state=' + encodeURIComponent('cId=' + this.clientId + '&domain=' + window.location.host + '&token=' + state);

			if (this.sameWinAuthMode)
			{
				window.location.assign(url);
				popup = null;
			}
			else if (popup == null)
			{
				popup = this.createAuthWin(url);
			}
			else
			{
				popup.location = url;
			}

			if (popup != null)
			{
				window.onGoogleDriveCallback = function(newAuthInfo, authWindow)
				{
					window.onGoogleDriveCallback = null;
					try
					{
						if (newAuthInfo == null)
						{
							if (error != null)
							{
								error({message: mxResources.get('accessDenied')});
							}
						}
						else
						{
							self.updateAuthInfo(newAuthInfo, remember, true, success, error);
						}
					}
					catch (e)
					{
						if (error != null)
						{
							error(e);
						}
					}
					finally
					{
						if (authWindow != null)
						{
							authWindow.close();
						}
					}
				};
				popup.focus();
			}
			else if (error != null)
			{
				error({message: mxResources.get('allowPopups')});
			}
		};
	}
})();
