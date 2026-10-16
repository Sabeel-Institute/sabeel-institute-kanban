import { useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { REPORT_TEXT_MAX, reportTextProblem } from '@sabeel/shared';
import { useNav } from '../nav';
import { reportDraft, sendReport } from '../reports';
import { useAction } from '../useAction';
import { Body, Button, Card, Hint, IconAction, Row, Screen, TextField, Title } from '../components/ui';

const FIELD_LABEL = 'What or who are you reporting, and what is wrong?';

const OUTCOMES = {
  mailed: 'Sent. An administrator will reply by email within a day.',
  saved: 'Your report was saved but the email did not go out; it will be looked at.',
} as const;

/**
 * Report a problem (More → Report a problem): one field and Send, and nothing
 * else — no categories, no picker, no history (docs/STORE-RELEASE.md § 4).
 * The person names the card, comment or person in their own words, which is
 * what lets one field report content and users alike.
 *
 * The report goes to the reportProblem callable, which keeps it and emails it
 * to the institute's administrators with Reply-To the reporter; their name and
 * email address go with it, and the screen says so before they send.
 *
 * The text lives in `reportDraft`, not here, so Back and coming back find it
 * as it was left. It clears only once the server has kept the report.
 */
export function ReportScreen() {
  const nav = useNav();
  const { text } = reportDraft.use();
  const { run, busy, error } = useAction('reportProblem');
  const [outcome, setOutcome] = useState<keyof typeof OUTCOMES | null>(null);
  // `busy` disables Send a render late; a second tap inside that frame would
  // file the same report twice. A ref is current at once.
  const sending = useRef(false);

  const send = () => {
    if (sending.current) return;
    sending.current = true;
    void run(async () => {
      setOutcome(null);
      const sent = text;
      const result = await sendReport(sent);
      // Kept by the server, so the field may clear — unless the person typed on
      // while it was sending, in which case that text is theirs and stays.
      reportDraft.set((draft) => (draft.text === sent ? { text: '' } : {}));
      setOutcome(result);
    }).finally(() => {
      sending.current = false;
    });
  };

  return (
    <Screen width="read">
      <Row style={styles.between}>
        <Title>Report a problem</Title>
        <IconAction icon="arrow-back" label="Back" onPress={nav.pop} />
      </Row>
      <Body>
        Your report goes by email to the institute&rsquo;s administrators, with your
        name and email address so they can reply.
      </Body>
      <Hint>{FIELD_LABEL}</Hint>
      <TextField
        label={FIELD_LABEL}
        value={text}
        onChangeText={(next) => {
          reportDraft.set({ text: next });
          if (outcome) setOutcome(null);
        }}
        multiline
        maxLength={REPORT_TEXT_MAX}
      />
      {outcome ? (
        <Card>
          <Body>{OUTCOMES[outcome]}</Body>
        </Card>
      ) : null}
      {error ? (
        <Card>
          <Body>{error}</Body>
        </Card>
      ) : null}
      <Button
        label="Send"
        busy={busy}
        disabled={reportTextProblem(text) !== null}
        onPress={send}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  between: { justifyContent: 'space-between' },
});
