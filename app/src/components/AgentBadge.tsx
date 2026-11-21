import { Text } from 'react-native';

/** Inline with the name of the person the agent acted for. */
export function AgentBadge() {
  return <Text accessibilityLabel="Via AI agent">{' 🤖'}</Text>;
}
