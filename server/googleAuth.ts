import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import type { Express } from 'express';
import * as auth from './auth';
import { createToken } from './jwt';
import { getSessionCookieOptions } from './_core/cookies';
import { COOKIE_NAME } from '@shared/const';
import { redactEmail, redactName } from './_core/redact';

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
// Prefer explicit GOOGLE_CALLBACK_URL; else derive from BASE_URL; else fall back to Fly.io.
// NOTE: whatever URL ends up here MUST also be registered under "Authorized redirect URIs"
// in the Google Cloud Console OAuth 2.0 client, or the callback will 400.
const GOOGLE_CALLBACK_URL =
  process.env.GOOGLE_CALLBACK_URL ||
  `${(process.env.BASE_URL || 'https://packgo-travel.fly.dev').replace(/\/$/, '')}/api/auth/google/callback`;

/**
 * Initialize Google OAuth strategy
 */
export function initializeGoogleAuth(app: Express) {
  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    console.warn('[Google OAuth] GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET not set — Google login disabled');
    return;
  }

  // Configure Google OAuth strategy
  passport.use(
    new GoogleStrategy(
      {
        clientID: GOOGLE_CLIENT_ID,
        clientSecret: GOOGLE_CLIENT_SECRET,
        callbackURL: GOOGLE_CALLBACK_URL,
        scope: ['profile', 'email'],
      },
      async (accessToken, refreshToken, profile, done) => {
        try {
          console.log('[Google OAuth] Strategy callback triggered');
          // Extract user info from Google profile
          const googleId = profile.id;
          const email = profile.emails?.[0]?.value;
          const name = profile.displayName;
          console.log('[Google OAuth] Profile data:', { googleId, email: redactEmail(email), name: redactName(name) });

          if (!email) {
            console.error('[Google OAuth] No email in profile');
            return done(new Error('No email found in Google profile'));
          }

          // Create or get user
          console.log('[Google OAuth] Creating or getting user...');
          const user = await auth.createOrGetGoogleUser(googleId, email, name);
          console.log('[Google OAuth] User created/retrieved:', user ? `${redactEmail(user.email)} (ID: ${user.id})` : 'null');

          return done(null, user);
        } catch (error) {
          console.error('[Google OAuth] Strategy error:', error);
          return done(error);
        }
      }
    )
  );

  // Initialize passport
  app.use(passport.initialize());

  // Google OAuth routes
  app.get(
    '/api/auth/google',
    passport.authenticate('google', { 
      scope: ['profile', 'email'],
      session: false 
    })
  );

  app.get(
    '/api/auth/google/callback',
    passport.authenticate('google', { 
      session: false,
      failureRedirect: '/login?error=google_auth_failed' 
    }),
    async (req, res) => {
      try {
        console.log('[Google OAuth] Callback triggered');
        const user = req.user as any;
        console.log('[Google OAuth] User from passport:', user ? `${redactEmail(user.email)} (ID: ${user.id})` : 'null');

        if (!user) {
          console.error('[Google OAuth] No user found in request');
          return res.redirect('/login?error=no_user');
        }

        // Create JWT token
        const token = createToken({
          userId: user.id,
          email: user.email,
          name: user.name || undefined,
          role: user.role,
        });
        console.log('[Google OAuth] JWT token created, length:', token.length);

        // Set cookie
        const cookieOptions = getSessionCookieOptions(req);
        console.log('[Google OAuth] Cookie options:', JSON.stringify(cookieOptions));
        
        res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 365 * 24 * 60 * 60 * 1000,
        });
        console.log('[Google OAuth] Cookie set with name:', COOKIE_NAME);

        // Redirect to home page
        console.log('[Google OAuth] Redirecting to home page');
        res.redirect('/');
      } catch (error) {
        console.error('[Google Auth] Callback error:', error);
        res.redirect('/login?error=auth_failed');
      }
    }
  );
}
