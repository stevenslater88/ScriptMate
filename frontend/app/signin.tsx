import React from 'react';
import { Redirect } from 'expo-router';

// In-app sign-in is not available; keep the route registered and send users home.
export default function SignInScreen() {
  return <Redirect href="/" />;
}
