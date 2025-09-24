import { registerAs } from "@nestjs/config";

// what is a factory function? 
// A factory function is a function that returns an object or value.
// In this case, we are using a factory function to create a configuration object for Google OAuth.
// This allows us to use environment variables to configure the Google OAuth client ID and secret.
export default registerAs("googleOAuth", () => ({
  clientId: process.env.GOOGLE_CLIENT_ID,
  clientSecret: process.env.GOOGLE_SECRET,
  googleCallbackUrl: process.env.GOOGLE_CALLBACK_URL
}));