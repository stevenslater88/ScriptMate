# ScriptMate - Complete Deployment Guide

Follow these steps in order to deploy your app to production.

---

## 📋 DEPLOYMENT CHECKLIST

### Prerequisites
- [ ] OpenAI API key (or continue using Emergent LLM key)
- [ ] Apple Developer Account ($99/year) - for iOS
- [ ] Google Play Developer Account ($25 one-time) - for Android
- [ ] Credit card for cloud services

---

## STEP 1: Set Up MongoDB Atlas (Free)

### 1.1 Create Account
1. Go to https://www.mongodb.com/atlas
2. Click "Try Free" and create an account
3. Choose the FREE "M0 Sandbox" cluster

### 1.2 Configure Cluster
1. Select cloud provider: AWS (recommended)
2. Select region closest to your users
3. Click "Create Cluster" (takes 3-5 minutes)

### 1.3 Set Up Access
1. Go to "Database Access" → Add New Database User
   - Username: `scriptmate_admin`
   - Password: (generate a strong password, SAVE IT!)
   - Role: "Read and write to any database"

2. Go to "Network Access" → Add IP Address
   - Click "Allow Access from Anywhere" (0.0.0.0/0)
   - This allows your deployed backend to connect

### 1.4 Get Connection String
1. Go to "Database" → Click "Connect"
2. Choose "Connect your application"
3. Copy the connection string, it looks like:
   ```
   mongodb+srv://scriptmate_admin:<password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority
   ```
4. Replace `<password>` with your actual password
5. Add database name: `mongodb+srv://...mongodb.net/scriptmate?retryWrites=true&w=majority`

**Save this connection string - you'll need it for Step 2!**

---

## STEP 2: Deploy Backend to Railway (Recommended)

### 2.1 Create Railway Account
1. Go to https://railway.app
2. Sign up with GitHub (recommended)

### 2.2 Create New Project
1. Click "New Project"
2. Select "Deploy from GitHub repo"
3. Connect your GitHub account if not already
4. You'll need to push your code to GitHub first (see Step 2.3)

### 2.3 Push Backend to GitHub
```bash
# On your local machine after downloading the code:
cd backend
git init
git add .
git commit -m "Initial commit - ScriptMate backend"
git remote add origin https://github.com/YOUR_USERNAME/scriptmate-backend.git
git push -u origin main
```

### 2.4 Configure Railway
1. Select your repository
2. Railway auto-detects Python
3. Go to "Variables" tab and add:
   ```
   MONGO_URL=mongodb+srv://scriptmate_admin:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/scriptmate?retryWrites=true&w=majority
   DB_NAME=scriptmate
   EMERGENT_LLM_KEY=sk-emergent-xxxxx (your key)
   PORT=8001
   ```

### 2.5 Configure Build Settings
1. Go to "Settings" tab
2. Set Start Command: `uvicorn server:app --host 0.0.0.0 --port $PORT`
3. Railway will auto-deploy

### 2.6 Get Your Backend URL
1. Go to "Settings" → "Domains"
2. Click "Generate Domain"
3. You'll get a URL like: `https://scriptmate-backend-production.up.railway.app`

**Save this URL - you'll need it for Step 3!**

---

## STEP 3: Update Mobile App Configuration

### 3.1 Update Backend URL
Edit `/app/frontend/.env`:
```
EXPO_PUBLIC_BACKEND_URL=https://your-railway-url.up.railway.app
```

### 3.2 Verify app.json is correct
Your `app.json` should have:
```json
{
  "expo": {
    "name": "ScriptMate",
    "slug": "scriptmate",
    "ios": {
      "bundleIdentifier": "com.scriptmate.app"
    },
    "android": {
      "package": "com.scriptmate.app"
    }
  }
}
```

---

## STEP 4: Build Mobile App with EAS

### 4.1 Install EAS CLI
```bash
npm install -g eas-cli
```

### 4.2 Login to Expo
```bash
eas login
# Enter your Expo account credentials
# Create account at https://expo.dev if needed
```

### 4.3 Configure EAS
```bash
cd frontend
eas build:configure
```

This creates `eas.json`. Use these settings:
```json
{
  "cli": {
    "version": ">= 3.0.0"
  },
  "build": {
    "development": {
      "developmentClient": true,
      "distribution": "internal"
    },
    "preview": {
      "distribution": "internal"
    },
    "production": {
      "ios": {
        "resourceClass": "m1-medium"
      },
      "android": {
        "buildType": "apk"
      }
    }
  },
  "submit": {
    "production": {}
  }
}
```

### 4.4 Build for iOS
```bash
eas build --platform ios --profile production
```
- First time: EAS will ask for Apple Developer credentials
- Build takes 15-30 minutes
- You'll get a download link for the .ipa file

### 4.5 Build for Android
```bash
eas build --platform android --profile production
```
- Build takes 10-20 minutes
- You'll get a download link for the .apk or .aab file

---

## STEP 5: Submit to App Stores

### 5.1 iOS App Store

#### Option A: Using EAS Submit (Easiest)
```bash
eas submit --platform ios
```
- Requires Apple Developer account
- EAS handles the upload automatically

#### Option B: Manual Upload
1. Download .ipa from EAS
2. Open Transporter app (Mac only)
3. Upload .ipa to App Store Connect
4. Go to https://appstoreconnect.apple.com
5. Create new app, fill in details from APP_STORE_GUIDE.md
6. Submit for review

### 5.2 Google Play Store

#### Option A: Using EAS Submit
```bash
eas submit --platform android
```

#### Option B: Manual Upload
1. Download .aab from EAS
2. Go to https://play.google.com/console
3. Create new app
4. Upload .aab to Production track
5. Fill in store listing from APP_STORE_GUIDE.md
6. Submit for review

---

## STEP 6: Post-Launch

### 6.1 Monitor Your App
- Railway Dashboard: Monitor backend health
- MongoDB Atlas: Monitor database usage
- App Store Connect: Monitor downloads & reviews
- Google Play Console: Monitor downloads & reviews

### 6.2 Set Up Real Payments
For actual subscriptions, you'll need to:
1. Implement StoreKit (iOS) / Google Play Billing (Android)
2. Use `react-native-iap` or `expo-in-app-purchases`
3. Verify receipts on your backend

### 6.3 Analytics (Optional)
Consider adding:
- Mixpanel or Amplitude for user analytics
- Sentry for error tracking
- RevenueCat for subscription management

---

## 💰 COST SUMMARY

| Service | Cost |
|---------|------|
| MongoDB Atlas | FREE (M0 tier) |
| Railway | FREE tier or ~$5/month |
| Apple Developer | $99/year |
| Google Play | $25 one-time |
| Expo/EAS | FREE tier available |

**Total to launch:** ~$125 first year

---

## 🆘 TROUBLESHOOTING

### Backend not connecting to MongoDB
- Check MONGO_URL has correct password
- Ensure "Allow from anywhere" is set in Network Access
- Check Railway logs for errors

### EAS Build failing
- Run `eas build --platform ios --clear-cache`
- Check app.json for valid bundle identifier
- Ensure all dependencies are compatible

### App rejected by App Store
- Review Apple's guidelines
- Common issues: missing privacy policy, unclear subscription terms
- Add required metadata and resubmit

---

## 📞 SUPPORT

- Expo Documentation: https://docs.expo.dev
- Railway Documentation: https://docs.railway.app
- MongoDB Atlas: https://docs.atlas.mongodb.com
- App Store Guidelines: https://developer.apple.com/app-store/review/guidelines/

---

Good luck with your launch! 🚀
