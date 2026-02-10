# ScriptMate Deployment Checklist

## 🎯 Pre-Deployment Status

### ✅ Completed In-App
- [x] Multi-region pricing (US/UK/EU)
- [x] 3-day free trial configured
- [x] Privacy Policy screen (`/privacy`)
- [x] Terms of Service screen (`/terms`)
- [x] Customer Support section (`/support`)
- [x] App icons created
- [x] Speech recognition integration
- [x] EAS build configuration
- [x] **RevenueCat Integration** (react-native-purchases installed)

---

## 📱 Step 1: Developer Accounts (Waiting)

| Platform | Status | Est. Time |
|----------|--------|----------|
| Apple Developer | ⏳ Pending verification | 24-72 hours |
| Google Play Console | ⏳ Pending verification | 24-48 hours |

---

## 🗄️ Step 2: Backend Deployment

### Option A: Railway (Recommended)

1. **Create Railway Account**: https://railway.app
2. **Connect GitHub** (or upload code)
3. **Create New Project** → Deploy from repo
4. **Add MongoDB Plugin** or use MongoDB Atlas
5. **Set Environment Variables**:
   ```
   MONGO_URL=mongodb+srv://...
   DB_NAME=scriptmate
   EMERGENT_LLM_KEY=your_key_here
   ```
6. **Deploy** - Railway auto-detects Procfile

### Option B: MongoDB Atlas Setup

1. **Create Atlas Account**: https://www.mongodb.com/atlas
2. **Create Free Cluster** (M0 tier)
3. **Create Database User**
4. **Whitelist IPs** (0.0.0.0/0 for Railway)
5. **Get Connection String**
6. **Update Railway env vars** with Atlas URL

---

## 💳 Step 3: RevenueCat Payment Integration

### 3.1 RevenueCat Setup
1. **Create Account**: https://www.revenuecat.com
2. **Create New Project**: "ScriptMate"
3. **Get API Keys**:
   - Apple Public Key (for iOS)
   - Google Public Key (for Android)
   - Test Store Key (for development)

### 3.2 App Store Connect (After Apple Approval)
1. **Create App** in App Store Connect
2. **Create Subscriptions**:
   - `com.scriptmate.premium_monthly` - $9.99/£4.99/€6.99
   - `com.scriptmate.premium_yearly` - $79.99/£34.99/€39.99
3. **Configure 3-day free trial** for both
4. **Import to RevenueCat**

### 3.3 Google Play Console (After Google Approval)
1. **Create App** in Play Console
2. **Create Subscriptions** with same IDs
3. **Configure pricing** for all regions
4. **Import to RevenueCat**

### 3.4 RevenueCat Configuration
1. **Create Entitlement**: `premium`
2. **Attach both products** to entitlement
3. **Create Offering**: `default`
4. **Add packages**: monthly & yearly

---

## 🖼️ Step 4: App Store Assets

### Screenshots Needed
| Device | Size | Quantity |
|--------|------|----------|
| iPhone 6.7" | 1290 x 2796 | 5-10 |
| iPhone 6.5" | 1284 x 2778 | 5-10 |
| iPhone 5.5" | 1242 x 2208 | 5-10 |
| iPad 12.9" | 2048 x 2732 | 5-10 |
| Android Phone | 1080 x 1920 | 5-10 |
| Android Tablet | 1920 x 1080 | 2-5 |

### Screenshot Scenes to Capture
1. Home screen with scripts list
2. Script upload/paste screen
3. Character selection
4. Rehearsal in progress (AI speaking)
5. Premium features showcase
6. Training modes overview
7. Support/Help screen

---

## 🔐 Step 5: Environment Variables

### Frontend (.env.production)
```env
EXPO_PUBLIC_BACKEND_URL=https://your-railway-app.up.railway.app
EXPO_PUBLIC_REVENUECAT_APPLE_API_KEY=appl_xxxxx
EXPO_PUBLIC_REVENUECAT_GOOGLE_API_KEY=goog_xxxxx
```

### Backend (.env.production)
```env
MONGO_URL=mongodb+srv://user:pass@cluster.mongodb.net/scriptmate
DB_NAME=scriptmate
EMERGENT_LLM_KEY=your_production_key
REVENUECAT_WEBHOOK_SECRET=your_webhook_secret
```

---

## 🏗️ Step 6: Build & Submit

### iOS Build
```bash
cd frontend
eas build --platform ios --profile production
```

### Android Build
```bash
eas build --platform android --profile production
```

### Submit to Stores
```bash
# iOS
eas submit --platform ios

# Android  
eas submit --platform android
```

---

## 📝 Step 7: Store Listings

### App Information
- **App Name**: ScriptMate
- **Subtitle**: AI Script Learning Partner
- **Category**: Entertainment / Education
- **Age Rating**: 4+ (no objectionable content)

### Description (from APP_STORE_GUIDE.md)
See `/app/APP_STORE_GUIDE.md` for full store listing copy.

### Keywords (iOS)
`acting, script, rehearsal, memorize lines, actor, audition, monologue, dialogue, theater, drama, TTS, AI partner`

---

## ✅ Final Checklist Before Submit

- [ ] Backend deployed and tested
- [ ] MongoDB Atlas/Railway DB configured
- [ ] RevenueCat products created and tested
- [ ] All screenshots captured
- [ ] Privacy Policy URL accessible
- [ ] Terms of Service URL accessible
- [ ] App icons finalized
- [ ] Test all flows on physical device
- [ ] Production environment variables set
- [ ] Webhook endpoint configured

---

## 📞 Support Contacts

- **Apple Developer Support**: https://developer.apple.com/contact/
- **Google Play Support**: https://support.google.com/googleplay/android-developer/
- **RevenueCat Support**: https://www.revenuecat.com/support
- **Railway Support**: https://railway.app/help
