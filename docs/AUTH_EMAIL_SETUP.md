# Supabase Auth Email & Redirect Configuration

This document specifies the exact email templates and redirect URL allowlist entries required in the Supabase Dashboard for CampBite authentication, recovery, and invitations.

---

## 1. Supabase Dashboard URL Configuration

In **Authentication -> URL Configuration**:

- **Site URL**:
  ```text
  https://<your-canteen-domain>
  ```
  *(Example for production: `https://campus-canteen.vercel.app`)*

- **Redirect URLs (Allowlist)**:
  Add the following explicit route destinations:
  ```text
  https://<your-canteen-domain>/auth/confirm
  https://<your-canteen-domain>/auth/callback
  https://<your-canteen-domain>/set-password
  https://<your-canteen-domain>/profile
  https://<your-canteen-domain>/**
  http://localhost:3000/**
  ```

---

## 2. Supabase Email Templates

In **Authentication -> Email Templates**, update each template to use the `token_hash` verification flow. This format avoids PKCE cross-browser/cross-app cookie loss (e.g. when opening links from Gmail's in-app browser or between Chrome and the Android TWA app) and shields against email link scanner prefetch consumption.

### Template 1: Reset Password
* **Dashboard Template Name**: `Reset Password`
* **Subject**: `Reset your CampBite password`
* **Body**:
```html
<h2>Reset Password</h2>
<p>Follow this link to reset your CampBite account password:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=recovery&next=/set-password">Reset Password</a></p>
<p>If you did not request a password reset, you can safely ignore this email.</p>
```

---

### Template 2: Confirm (Sign Up)
* **Dashboard Template Name**: `Confirm signup`
* **Subject**: `Confirm your CampBite registration`
* **Body**:
```html
<h2>Confirm Your Registration</h2>
<p>Welcome to CampBite! Follow this link to confirm your campus email and activate your account:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=signup&next=/">Confirm Email</a></p>
```

---

### Template 3: Invite User
* **Dashboard Template Name**: `Invite user`
* **Subject**: `You have been invited to CampBite`
* **Body**:
```html
<h2>Accept Your Staff Invitation</h2>
<p>You have been invited to join CampBite as staff. Follow this link to accept your invitation and configure your account password:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=invite&next=/set-password">Accept Invitation</a></p>
```

---

### Template 4: Magic Link
* **Dashboard Template Name**: `Magic Link`
* **Subject**: `Your CampBite sign-in link`
* **Body**:
```html
<h2>Sign In to CampBite</h2>
<p>Follow this link to securely sign in to your CampBite account:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=magiclink&next=/">Sign In</a></p>
<p>If you did not request this link, you can safely ignore this email.</p>
```

---

### Template 5: Change Email Address
* **Dashboard Template Name**: `Change Email Address`
* **Subject**: `Confirm your new CampBite email address`
* **Body**:
```html
<h2>Confirm Email Change</h2>
<p>Follow this link to confirm updating your CampBite email address:</p>
<p><a href="{{ .SiteURL }}/auth/confirm?token_hash={{ .TokenHash }}&type=email_change&next=/profile">Confirm Email Change</a></p>
<p>If you did not request this change, please contact the canteen office immediately.</p>
```

---

## 3. Notes on Verification Architecture
- `/auth/confirm` supports both `token_hash` + `type` as well as legacy PKCE `code` and browser hash fragments (`#access_token=...`).
- Verification is scanner-safe: automated GET requests by email security scanners render a clean "Continue" confirmation page without consuming single-use OTP tokens. The token is only consumed upon an explicit user click.

