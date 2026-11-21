import { Text } from 'react-native';

/** Display the author with the agent badge immediately after their name. */
export function ActivityActor({ name, via }: { name: string; via?: 'agent' }) {
  return (
    <>
      {name}
      {via === 'agent' ? <Text accessibilityLabel="Via AI agent">{'\u00a0🤖'}</Text> : null}
    </>
  );
}
