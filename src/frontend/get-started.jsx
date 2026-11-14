// Get-started page. Replaces the Connect postInstallPage ("Install GitHub App Page").
import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Heading, Stack, LinkButton, List, ListItem, Code, Box } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [info, setInfo] = useState(null);
  useEffect(() => {
    invoke('getStarted').then(setInfo).catch(() => setInfo({ installUrl: 'https://github.com/settings/installations' }));
  }, []);
  return (
    <Box padding="space.300">
      <Stack space="space.200">
        <Heading as="h2">Create GitHub branches from Jira</Heading>
        <List type="ordered">
          <ListItem>Install the GitHub App on the repositories where branches should be created.</ListItem>
          <ListItem>Open any issue and expand GitHub Development in the right-hand column.</ListItem>
          <ListItem>Connect your GitHub account, choose the repository for the project, and create the branch.</ListItem>
        </List>
        {info ? <LinkButton href={info.installUrl} target="_blank" appearance="primary">Install the GitHub App</LinkButton> : null}
        <Heading as="h3">Branch naming</Heading>
        <Text>By default the branch is named after the issue key and starts from the repository's default branch. To change that, add a file named <Code>.github/jira-bot.yaml</Code> to the default branch:</Text>
        <List type="unordered">
          <ListItem><Code>branch_pattern: 1</Code> creates <Code>feature/KEY-123</Code> from <Code>develop</Code>.</ListItem>
          <ListItem><Code>branch_pattern: 2</Code> asks for a name and creates <Code>KEY-123/your-name</Code>.</ListItem>
          <ListItem><Code>default_base_branch_name: 'dev'</Code> starts new branches from that branch.</ListItem>
        </List>
        <Text>After changing the file, choose Change next to the repository name in an issue and select the repository again.</Text>
      </Stack>
    </Box>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
