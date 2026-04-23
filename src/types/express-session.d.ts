import 'express-session';

declare module 'express-session' {
  interface SessionData {
    githubId?: string;
    oauthState?: string;
  }
}
