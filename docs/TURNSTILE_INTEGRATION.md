# Cloudflare Turnstile Integration

This application now supports Cloudflare Turnstile for bot protection on authentication forms.

## What is Cloudflare Turnstile?

Cloudflare Turnstile is a privacy-first, free CAPTCHA alternative that helps protect your website from bots and spam. It's designed to be user-friendly and doesn't require users to solve puzzles or identify images.

## Setup Instructions

### 1. Get Your Turnstile Keys

1. Go to [Cloudflare Turnstile](https://dash.cloudflare.com/?to=/:account/turnstile)
2. Log in to your Cloudflare account
3. Click "Add site"
4. Configure your site:
   - **Name**: Your site name (e.g., "TimeOff Management")
   - **Domain**: Your domain (e.g., `pto.tonysapps.info`)
   - **Widget Type**: Choose "Managed" (recommended for most use cases)
5. Copy your **Site Key** and **Secret Key**

### 2. Configure Environment Variables

Add the following environment variables to your application:

```bash
# Cloudflare Turnstile Configuration
TURNSTILE_SITE_KEY="your_site_key_here"
TURNSTILE_SECRET_KEY="your_secret_key_here"
```

### 3. Restart Your Application

After adding the environment variables, restart your application for the changes to take effect.

## How It Works

### Frontend Integration

The Turnstile widget is automatically added to the following forms when configured:

- **Login Form** (`/login`)
- **Forgot Password Form** (`/forgot-password/`)
- **Registration Form** (`/register`)
- **Reset Password Form** (`/reset-password/`)

The widget appears as a simple checkbox that users can click to verify they're human.

### Backend Verification

When users submit forms, the application:

1. Extracts the Turnstile token from the form submission
2. Sends the token to Cloudflare's verification endpoint
3. Only proceeds with the form action if verification succeeds
4. Shows an error message if verification fails

## Security Features

- **IP Address Tracking**: The user's IP address is included in verification requests
- **Token Validation**: All tokens are validated server-side before processing
- **Graceful Degradation**: If Turnstile is not configured, forms work normally
- **Error Handling**: Comprehensive error handling with user-friendly messages

## Testing

### Unit Tests

Run the Turnstile unit tests:

```bash
npm test -- --grep "Turnstile"
```

### Manual Testing

1. Set up Turnstile with your keys
2. Visit the login page
3. You should see the Turnstile widget
4. Try submitting the form without completing the challenge
5. Try submitting with a completed challenge

## Troubleshooting

### Widget Not Appearing

- Check that `TURNSTILE_SITE_KEY` is set correctly
- Verify the environment variable is loaded (restart the application)
- Check browser console for JavaScript errors

### Verification Failing

- Check that `TURNSTILE_SECRET_KEY` is set correctly
- Verify the domain in your Turnstile configuration matches your site
- Check application logs for verification errors

### Common Issues

1. **Domain Mismatch**: Ensure the domain in Turnstile matches your actual domain
2. **Key Format**: Make sure keys are copied exactly as shown in Cloudflare dashboard
3. **Environment Variables**: Verify variables are set in the correct environment

## Configuration Options

The Turnstile integration supports the following configuration:

```javascript
// In lib/config.js
turnstile: {
  site_key: process.env.TURNSTILE_SITE_KEY || '',
  secret_key: process.env.TURNSTILE_SECRET_KEY || ''
}
```

## Disabling Turnstile

To disable Turnstile:

1. Remove or comment out the environment variables
2. Restart the application
3. Forms will work normally without the challenge

## Privacy and Compliance

- Turnstile is privacy-first and GDPR compliant
- No personal data is sent to Cloudflare beyond what's necessary for verification
- The widget respects user privacy settings and accessibility preferences

## Support

For issues with Turnstile integration:

1. Check the application logs for error messages
2. Verify your Cloudflare Turnstile configuration
3. Test with a simple form submission
4. Contact support if issues persist

For Cloudflare Turnstile support, visit the [Cloudflare documentation](https://developers.cloudflare.com/turnstile/).