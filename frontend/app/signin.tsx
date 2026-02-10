import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Alert,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
// TEMPORARILY DISABLED: Apple Sign-In disabled until provisioning profile is updated
// import * as AppleAuthentication from 'expo-apple-authentication';
import { useAuth } from '../contexts/AuthContext';

export default function SignInScreen() {
  // TEMPORARILY DISABLED: Apple Sign-In disabled until provisioning profile is updated
  const { signInWithGoogle, isAuthenticated } = useAuth();
  const [loading, setLoading] = useState<'apple' | 'google' | null>(null);

  // Redirect if already authenticated
  React.useEffect(() => {
    if (isAuthenticated) {
      router.replace('/');
    }
  }, [isAuthenticated]);

  // TEMPORARILY DISABLED: Apple Sign-In disabled until provisioning profile is updated
  // const handleAppleSignIn = async () => {
  //   setLoading('apple');
  //   try {
  //     await signInWithApple();
  //     router.replace('/');
  //   } catch (error: any) {
  //     if (error.message !== 'User cancelled') {
  //       Alert.alert('Sign-In Failed', error.message || 'Please try again');
  //     }
  //   } finally {
  //     setLoading(null);
  //   }
  // };

  const handleGoogleSignIn = async () => {
    // TEMPORARILY DISABLED: Google Sign-In requires OAuth credentials
    Alert.alert(
      'Coming Soon',
      'Google Sign-In will be available in a future update. For now, you can use the app without signing in.',
      [{ text: 'OK' }]
    );
    return;
    
    // Original implementation (uncomment when OAuth is configured):
    // setLoading('google');
    // try {
    //   await signInWithGoogle();
    //   router.replace('/');
    // } catch (error: any) {
    //   if (error.message !== 'User cancelled') {
    //     Alert.alert('Sign-In Failed', error.message || 'Please try again');
    //   }
    // } finally {
    //   setLoading(null);
    // }
  };

  const handleSkip = () => {
    router.replace('/');
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.content}>
        {/* Logo */}
        <View style={styles.logoContainer}>
          <Ionicons name="mic" size={64} color="#6366f1" />
          <Text style={styles.logoText}>ScriptMate</Text>
          <Text style={styles.tagline}>AI Script Learning Partner</Text>
        </View>

        {/* Sync Benefits */}
        <View style={styles.benefitsContainer}>
          <Text style={styles.benefitsTitle}>Sign in to sync across devices</Text>
          
          <View style={styles.benefitItem}>
            <Ionicons name="sync-circle" size={24} color="#10b981" />
            <Text style={styles.benefitText}>Access scripts on iPhone, iPad & Android</Text>
          </View>
          
          <View style={styles.benefitItem}>
            <Ionicons name="cloud-done" size={24} color="#10b981" />
            <Text style={styles.benefitText}>Director notes saved to cloud</Text>
          </View>
          
          <View style={styles.benefitItem}>
            <Ionicons name="stats-chart" size={24} color="#10b981" />
            <Text style={styles.benefitText}>Performance stats sync everywhere</Text>
          </View>
          
          <View style={styles.benefitItem}>
            <Ionicons name="shield-checkmark" size={24} color="#10b981" />
            <Text style={styles.benefitText}>Never lose your progress</Text>
          </View>
        </View>

        {/* Sign-In Buttons */}
        <View style={styles.buttonsContainer}>
          {/* TEMPORARILY DISABLED: Apple Sign-In disabled until provisioning profile is updated */}
          {/* Apple Sign-In (iOS only) */}
          {/* {Platform.OS === 'ios' && (
            <AppleAuthentication.AppleAuthenticationButton
              buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
              buttonStyle={AppleAuthentication.AppleAuthenticationButtonStyle.WHITE}
              cornerRadius={12}
              style={styles.appleButton}
              onPress={handleAppleSignIn}
            />
          )} */}

          {/* Fallback Apple button for web/Android preview - TEMPORARILY DISABLED */}
          {/* {Platform.OS !== 'ios' && (
            <TouchableOpacity
              style={styles.socialButton}
              onPress={handleAppleSignIn}
              disabled={loading !== null}
            >
              {loading === 'apple' ? (
                <ActivityIndicator color="#000" />
              ) : (
                <>
                  <Ionicons name="logo-apple" size={24} color="#000" />
                  <Text style={styles.socialButtonText}>Sign in with Apple</Text>
                </>
              )}
            </TouchableOpacity>
          )} */}

          {/* Google Sign-In - Coming Soon */}
          <TouchableOpacity
            style={[styles.socialButton, styles.googleButton, styles.comingSoonButton]}
            onPress={handleGoogleSignIn}
          >
            <Ionicons name="logo-google" size={22} color="#fff" />
            <Text style={[styles.socialButtonText, styles.googleButtonText]}>
              Sign in with Google
            </Text>
            <View style={styles.comingSoonBadge}>
              <Text style={styles.comingSoonText}>Soon</Text>
            </View>
          </TouchableOpacity>

          {/* Skip Button */}
          <TouchableOpacity style={styles.skipButton} onPress={handleSkip}>
            <Text style={styles.skipButtonText}>Continue without signing in</Text>
          </TouchableOpacity>

          {/* Info Text */}
          <Text style={styles.infoText}>
            Cross-device sync coming soon! Your data is saved locally for now.
          </Text>
        </View>

        {/* Footer */}
        <Text style={styles.footerText}>
          By signing in, you agree to our{' '}
          <Text style={styles.linkText} onPress={() => router.push('/terms')}>Terms</Text>
          {' '}and{' '}
          <Text style={styles.linkText} onPress={() => router.push('/privacy')}>Privacy Policy</Text>
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0f',
  },
  content: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 40,
  },
  logoText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#fff',
    marginTop: 12,
  },
  tagline: {
    fontSize: 16,
    color: '#6b7280',
    marginTop: 4,
  },
  benefitsContainer: {
    backgroundColor: '#1a1a2e',
    borderRadius: 16,
    padding: 20,
    marginBottom: 32,
    borderWidth: 1,
    borderColor: '#2a2a3e',
  },
  benefitsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 16,
    textAlign: 'center',
  },
  benefitItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  benefitText: {
    fontSize: 15,
    color: '#9ca3af',
    flex: 1,
  },
  buttonsContainer: {
    gap: 12,
  },
  appleButton: {
    height: 56,
    width: '100%',
  },
  socialButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#fff',
    height: 56,
    borderRadius: 12,
    gap: 10,
  },
  socialButtonText: {
    fontSize: 17,
    fontWeight: '600',
    color: '#000',
  },
  googleButton: {
    backgroundColor: '#4285F4',
  },
  googleButtonText: {
    color: '#fff',
  },
  comingSoonButton: {
    opacity: 0.7,
  },
  comingSoonBadge: {
    position: 'absolute',
    right: 12,
    backgroundColor: '#f59e0b',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 10,
  },
  comingSoonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 16,
    marginTop: 8,
  },
  skipButtonText: {
    fontSize: 15,
    color: '#6b7280',
  },
  infoText: {
    fontSize: 13,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 8,
    fontStyle: 'italic',
  },
  footerText: {
    fontSize: 12,
    color: '#6b7280',
    textAlign: 'center',
    marginTop: 24,
    lineHeight: 18,
  },
  linkText: {
    color: '#6366f1',
    textDecorationLine: 'underline',
  },
});
