import { app } from '../src/server/app.js';

// Vercel invokes the Express application as one serverless function. Database
// migrations are applied separately; request cold starts never run DDL.
export default app;
