import { Box, Text } from "ink";

export function DiffView({ diffText }: { diffText: string }) {
  const lines = diffText.split("\n");
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      {lines.map((line, i) => {
        let color: string | undefined;
        if (line.startsWith("+") && !line.startsWith("+++")) color = "green";
        else if (line.startsWith("-") && !line.startsWith("---")) color = "red";
        else if (line.startsWith("@@")) color = "cyan";
        return (
          <Text key={i} color={color} dimColor={!color}>
            {line || " "}
          </Text>
        );
      })}
    </Box>
  );
}
