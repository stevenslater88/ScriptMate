// Onboarding Screen Route
import React from 'react';
import { router } from 'expo-router';
import OnboardingTutorial from '../components/OnboardingTutorial';

export default function OnboardingScreen() {
  const handleComplete = () => {
    router.replace('/');
  };

  return <OnboardingTutorial onComplete={handleComplete} />;
}
