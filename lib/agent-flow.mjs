export function canUseFile(file, agent, chat) {
  return file.agentId === agent.id || Boolean(file.projectId && file.projectId === chat?.projectId);
}

export function selectSpeakers(chat, text, agents) {
  const members = (chat.agentIds || [chat.agentId]).map(id => agents.find(a => a.id === id)).filter(Boolean);
  if (members.length < 2) return members;
  const low = text.toLowerCase();
  const named = members.filter(a => low.includes('@' + a.name.toLowerCase()));
  return named.length ? named : members;
}

export function routineDue(routine, now) {
  const time = now.getTime();
  if (routine.everyMinutes) return time - routine.lastRun >= routine.everyMinutes * 60_000;
  return routine.dailyAt === now.toTimeString().slice(0, 5)
    && (routine.weekday == null || routine.weekday === now.getDay())
    && time - routine.lastRun > 60_000;
}

export function mayFallback(streamedText, isLastAttempt) {
  return !streamedText && !isLastAttempt;
}
