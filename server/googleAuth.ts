import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import type { Express, Request, Response } from 'express';
import { randomBytes, timingSafeEqual } from 'crypto';
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

  // Google OAuth routes.
  //
  // SECURITY_AUDIT_2026_05_14 P1-7: login-CSRF. Without a `state` param,
  // an attacker could start a Google OAuth in their browser, intercept
  // the callback URL, trick the victim into clicking it, and have the
  // victim's browser silently complete OAuth as the attacker (the
  // SameSite=lax cookie rides along on top-level navigation). New
  // behavior: generate a random `state` on /api/auth/google, store it in
  // a short-lived cookie, and on /callback compare via timingSafeEqual.
  const STATE_COOKIE = 'pgo_oauth_state';
  const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes — Google OAuth flow

  app.get('/api/auth/google', (req: Request, res: Response, next) => {
    const state = randomBytes(24).toString('hex');
    // Use SameSite=lax so the cookie rides along when Google redirects
    // back; httpOnly so JS can't read it; Secure under HTTPS.
    const isHttps =
      req.protocol === 'https' ||
      (req.headers['x-forwarded-proto'] === 'https');
    res.cookie(STATE_COOKIE, state, {
      httpOnly: true,
      sameSite: 'lax',
      secure: isHttps,
      maxAge: STATE_TTL_MS,
      path: '/api/auth/google',
    });
    return passport.authenticate('google', {
      scope: ['profile', 'email'],
      session: false,
      state,
    })(req, res, next);
  });

  app.get(
    '/api/auth/google/callback',
    // Verify state BEFORE letting passport consume the code. If state is
    // missing or mismatched we redirect to /login without exchanging the
    // code, so the attacker can't burn a victim's OAuth code either.
    (req: Request, res: Response, next) => {
      const givenState = typeof req.query.state === 'string' ? req.query.state : '';
      const expectedState = (req as any).cookies?.[STATE_COOKIE] || '';
      // Always clear the state cookie so a single state can't be reused.
      res.clearCookie(STATE_COOKIE, { path: '/api/auth/google' });
      const givenBuf = Buffer.from(givenState);
      const expectedBuf = Buffer.from(expectedState);
      if (
        !givenState ||
        !expectedState ||
        givenBuf.length !== expectedBuf.length ||
        !timingSafeEqual(givenBuf, expectedBuf)
      ) {
        console.warn('[Google OAuth] state mismatch — possible CSRF');
        return res.redirect('/login?error=state_mismatch');
      }
      return next();
    },
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
        
        // SECURITY_AUDIT_2026_05_14 P2-4: cookie maxAge was 365d while JWT
        // expiry is 14d (server/jwt.ts JWT_EXPIRES_IN). After day 14 the
        // cookie sits there for 351 more days only to fail verification on
        // every request — useless and confusing. Match the JWT TTL so the
        // browser drops the cookie at the same time the server stops
        // accepting it. Longer sessions should come from a refresh-token
        // flow, not a long-lived access token.
        res.cookie(COOKIE_NAME, token, {
          ...cookieOptions,
          maxAge: 14 * 24 * 60 * 60 * 1000,
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
