// The issue panel. Replaces the Connect web panel (an iframe served by the Sinatra app) with UI Kit.
import React, { useCallback, useEffect, useState } from 'react';
import ForgeReconciler, {
  Text, Button, LinkButton, Stack, Inline, Select, Textfield, Link, Lozenge, Spinner, SectionMessage, Strong,
} from '@forge/react';
import { invoke } from '@forge/bridge';

const PULL_LOOK = { open: 'inprogress', merged: 'success', closed: 'removed' };

const App = () => {
  const [state, setState] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState(null);
  const [choice, setChoice] = useState(null);
  const [customName, setCustomName] = useState('');

  const load = useCallback(async () => {
    try {
      setState(await invoke('getState'));
    } catch (err) {
      setState({ view: 'error', message: 'The panel could not load. Reload the page.' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (fn, payload) => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await invoke(fn, payload);
      if (result && result.ok === false) setNotice(result.message);
      await load();
    } catch (err) {
      setNotice('That did not work. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!state) return <Spinner label="Loading GitHub branches" />;

  const warning = notice ? <SectionMessage appearance="warning"><Text>{notice}</Text></SectionMessage> : null;

  if (state.view === 'unlicensed') {
    return <SectionMessage appearance="warning" title="No active license"><Text>Ask a Jira administrator to renew this app.</Text></SectionMessage>;
  }

  if (state.view === 'error') {
    return (
      <Stack space="space.100">
        <SectionMessage appearance="error"><Text>{state.message}</Text></SectionMessage>
        <Inline space="space.100">
          <Button onClick={load}>Try again</Button>
          {state.canChooseAgain ? <Button isDisabled={busy} onClick={() => run('clearRepo')}>Choose another repository</Button> : null}
        </Inline>
      </Stack>
    );
  }

  if (state.view === 'install') {
    return (
      <Stack space="space.100">
        <Text>Your GitHub account is connected, but the GitHub App is not installed on any repository yet.</Text>
        <Inline space="space.100">
          <LinkButton href={state.installUrl} target="_blank" appearance="primary">Install the GitHub App</LinkButton>
          <Button onClick={load}>Check again</Button>
        </Inline>
      </Stack>
    );
  }

  if (state.view === 'choose') {
    return (
      <Stack space="space.100">
        <Text>Choose the repository for this project.</Text>
        <Select
          placeholder="Repository"
          options={state.repos.map((name) => ({ label: name, value: name }))}
          onChange={(option) => setChoice(option ? option.value : null)}
        />
        <Inline space="space.100" alignBlock="center">
          <Button appearance="primary" isDisabled={!choice || busy} isLoading={busy} onClick={() => run('selectRepo', { fullName: choice })}>Use this repository</Button>
          <Link href={state.installUrl} openNewTab>Add repositories</Link>
        </Inline>
        {warning}
      </Stack>
    );
  }

  const repoLine = (
    <Inline space="space.100" alignBlock="center">
      <Link href={state.repoUrl} openNewTab>{state.repo}</Link>
      <Button appearance="subtle" spacing="compact" isDisabled={busy} onClick={() => run('clearRepo')}>Change</Button>
    </Inline>
  );

  if (state.view === 'linked') {
    return (
      <Stack space="space.100">
        {repoLine}
        {state.branches.map((branch) => (
          <Stack space="space.050" key={branch.name}>
            <Inline space="space.100" alignBlock="center">
              <Lozenge appearance="success">Branch</Lozenge>
              <Link href={branch.url} openNewTab>{branch.name}</Link>
            </Inline>
            {branch.pulls.map((pull) => (
              <Inline space="space.100" alignBlock="center" key={pull.number}>
                <Lozenge appearance={PULL_LOOK[pull.state] || 'default'}>{pull.state}</Lozenge>
                <Link href={pull.url} openNewTab>{`#${pull.number} ${pull.title}`}</Link>
              </Inline>
            ))}
          </Stack>
        ))}
        {warning}
      </Stack>
    );
  }

  return (
    <Stack space="space.100">
      {repoLine}
      {state.asksForName ? (
        <Textfield placeholder="Branch name, for example my-great-feature" value={customName} onChange={(event) => setCustomName(event.target.value)} />
      ) : (
        <Text>Creates <Strong>{state.preview.name}</Strong> from <Strong>{state.preview.base}</Strong>.</Text>
      )}
      <Button appearance="primary" isDisabled={busy || (state.asksForName && !customName.trim())} isLoading={busy} onClick={() => run('createBranch', { customName })}>Create branch</Button>
      {warning}
    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
