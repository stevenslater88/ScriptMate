// Premium Upgrade Prompts - Natural, Value-Driven Components
import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';

// ═══════════════════════════════════════════════════════════════════════════
// UPGRADE PROMPT TYPES
// ═══════════════════════════════════════════════════════════════════════════

type PromptType = 'recall' | 'shotcoach' | 'auditions';

interface PromptConfig {
  icon: string;
  iconColor: string;
  title: string;
  message: string;
  buttonText: string;
}

const PROMPT_CONFIGS: Record<PromptType, PromptConfig> = {
  recall: {
    icon: 'flash',
    iconColor: '#6366f1',
    title: 'Unlock Advanced Recall',
    message: "You've reached the basic practice level.\nUnlock full difficulty control, timed challenges, and mastery tracking to train like a professional.",
    buttonText: 'Unlock Advanced Practice',
  },
  shotcoach: {
    icon: 'videocam',
    iconColor: '#10b981',
    title: 'Unlock Director Mode',
    message: 'Get performance feedback, framing scores, and casting-ready guidance on every self-tape.',
    buttonText: 'Unlock Director Mode',
  },
  auditions: {
    icon: 'clipboard',
    iconColor: '#f59e0b',
    title: 'Upgrade Your Career Toolkit',
    message: 'Track unlimited auditions, follow-ups, and performance stats in one place.',
    buttonText: 'Unlock Pro Tools',
  },
};

// ═══════════════════════════════════════════════════════════════════════════
// SOFT INLINE PROMPT (Non-blocking, appears inline)
// ═══════════════════════════════════════════════════════════════════════════

interface SoftUpgradePromptProps {
  type: PromptType;
  onUpgrade?: () => void;
}

export function SoftUpgradePrompt({ type, onUpgrade }: SoftUpgradePromptProps) {
  const config = PROMPT_CONFIGS[type];
  
  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      router.push('/premium');
    }
  };

  return (
    <View style={styles.softContainer}>
      <View style={[styles.softIconContainer, { backgroundColor: `${config.iconColor}12` }]}>
        <Ionicons name={config.icon as any} size={24} color={config.iconColor} />
      </View>
      <View style={styles.softContent}>
        <Text style={styles.softTitle}>{config.title}</Text>
        <Text style={styles.softMessage}>{config.message}</Text>
        <TouchableOpacity 
          style={[styles.softButton, { backgroundColor: config.iconColor }]}
          onPress={handleUpgrade}
        >
          <Text style={styles.softButtonText}>{config.buttonText}</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// MODAL PROMPT (Used for hard limits, but still value-driven)
// ═══════════════════════════════════════════════════════════════════════════

interface UpgradeModalProps {
  visible: boolean;
  type: PromptType;
  onClose: () => void;
  onUpgrade?: () => void;
}

export function UpgradeModal({ visible, type, onClose, onUpgrade }: UpgradeModalProps) {
  const config = PROMPT_CONFIGS[type];
  
  const handleUpgrade = () => {
    onClose();
    if (onUpgrade) {
      onUpgrade();
    } else {
      router.push('/premium');
    }
  };

  return (
    <Modal visible={visible} transparent animationType="fade">
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {/* Close button */}
          <TouchableOpacity style={styles.modalClose} onPress={onClose}>
            <Ionicons name="close" size={24} color="#6b7280" />
          </TouchableOpacity>
          
          {/* Icon */}
          <View style={[styles.modalIconContainer, { backgroundColor: `${config.iconColor}15` }]}>
            <Ionicons name={config.icon as any} size={36} color={config.iconColor} />
          </View>
          
          {/* Content */}
          <Text style={styles.modalTitle}>{config.title}</Text>
          <Text style={styles.modalMessage}>{config.message}</Text>
          
          {/* Action */}
          <TouchableOpacity 
            style={[styles.modalButton, { backgroundColor: config.iconColor }]}
            onPress={handleUpgrade}
          >
            <Text style={styles.modalButtonText}>{config.buttonText}</Text>
          </TouchableOpacity>
          
          {/* Skip */}
          <TouchableOpacity style={styles.modalSkip} onPress={onClose}>
            <Text style={styles.modalSkipText}>Maybe later</Text>
          </TouchableOpacity>
        </View>
      </View>
    </Modal>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// COMPACT UPGRADE BANNER (For inline hints)
// ═══════════════════════════════════════════════════════════════════════════

interface CompactUpgradeBannerProps {
  type: PromptType;
  compact?: boolean;
}

export function CompactUpgradeBanner({ type, compact = false }: CompactUpgradeBannerProps) {
  const config = PROMPT_CONFIGS[type];
  
  return (
    <TouchableOpacity 
      style={[styles.bannerContainer, compact && styles.bannerCompact]}
      onPress={() => router.push('/premium')}
    >
      <Ionicons name="lock-closed" size={14} color={config.iconColor} />
      <Text style={[styles.bannerText, { color: config.iconColor }]}>
        {compact ? 'Premium' : config.buttonText}
      </Text>
      <Ionicons name="chevron-forward" size={14} color={config.iconColor} />
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// FEATURE LOCKED CARD (For showing locked features)
// ═══════════════════════════════════════════════════════════════════════════

interface FeatureLockedCardProps {
  title: string;
  description: string;
  icon: string;
  iconColor: string;
}

export function FeatureLockedCard({ title, description, icon, iconColor }: FeatureLockedCardProps) {
  return (
    <TouchableOpacity 
      style={styles.lockedCard}
      onPress={() => router.push('/premium')}
    >
      <View style={styles.lockedCardContent}>
        <View style={[styles.lockedIconContainer, { backgroundColor: `${iconColor}10` }]}>
          <Ionicons name={icon as any} size={22} color={iconColor} style={{ opacity: 0.5 }} />
          <View style={styles.lockBadge}>
            <Ionicons name="lock-closed" size={10} color="#f59e0b" />
          </View>
        </View>
        <View style={styles.lockedTextContainer}>
          <Text style={styles.lockedTitle}>{title}</Text>
          <Text style={styles.lockedDescription}>{description}</Text>
        </View>
      </View>
      <Ionicons name="chevron-forward" size={18} color="#4b5563" />
    </TouchableOpacity>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
// STYLES
// ═══════════════════════════════════════════════════════════════════════════

const styles = StyleSheet.create({
  // Soft Inline Prompt
  softContainer: {
    backgroundColor: '#111118',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  softIconContainer: {
    width: 56,
    height: 56,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    alignSelf: 'center',
    marginBottom: 16,
  },
  softContent: {
    alignItems: 'center',
  },
  softTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  softMessage: {
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 20,
    marginBottom: 20,
  },
  softButton: {
    paddingHorizontal: 24,
    paddingVertical: 14,
    borderRadius: 12,
  },
  softButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
  },

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  modalContent: {
    backgroundColor: '#111118',
    borderRadius: 20,
    padding: 28,
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1a1a2e',
  },
  modalClose: {
    position: 'absolute',
    top: 16,
    right: 16,
    padding: 4,
  },
  modalIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 15,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 24,
  },
  modalButton: {
    width: '100%',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  modalButtonText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
  },
  modalSkip: {
    marginTop: 16,
    padding: 8,
  },
  modalSkipText: {
    fontSize: 14,
    color: '#6b7280',
  },

  // Compact Banner
  bannerContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: 'rgba(245, 158, 11, 0.08)',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: 'rgba(245, 158, 11, 0.15)',
  },
  bannerCompact: {
    paddingVertical: 6,
    paddingHorizontal: 10,
  },
  bannerText: {
    fontSize: 13,
    fontWeight: '600',
  },

  // Locked Card
  lockedCard: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#111118',
    borderRadius: 14,
    padding: 14,
    borderWidth: 1,
    borderColor: '#1a1a2e',
    opacity: 0.75,
  },
  lockedCardContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  lockedIconContainer: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
  },
  lockBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: 'rgba(245, 158, 11, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#111118',
  },
  lockedTextContainer: {
    marginLeft: 14,
    flex: 1,
  },
  lockedTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#9ca3af',
  },
  lockedDescription: {
    fontSize: 12,
    color: '#6b7280',
    marginTop: 2,
  },
});
