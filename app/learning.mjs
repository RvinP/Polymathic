// The tutor returns a learning activity, not a wall of chat text.
export const activitySchema = {
  type: 'object', additionalProperties: false,
  properties: {
    kind: { type: 'string', enum: ['explain', 'challenge', 'feedback', 'question', 'summary'] },
    title: { type: 'string' },
    body: { type: 'string' },
    question: { type: 'string' },
    hints: { type: 'array', items: { type: 'string' } },
    goal: { type: 'string' },
    focus: { type: 'string' },
    concepts: { type: 'array', items: { type: 'string' } },
    outcome: { type: 'string', enum: ['none', 'independent', 'assisted', 'not_yet'] },
    takeaway: { type: 'string' },
    park: { type: 'string' },
  },
  required: ['kind', 'title', 'body', 'question', 'hints', 'goal', 'focus', 'concepts', 'outcome', 'takeaway', 'park'],
};
export function parseActivity(raw) {
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw.trim().replace(/^```(?:json)?\s*|\s*```$/g, '')) : raw;
    if (!value || !activitySchema.properties.kind.enum.includes(value.kind)) return null;
    for (const key of ['title','body','question','goal','focus','takeaway','park']) if (typeof value[key] !== 'string') return null;
    if (!activitySchema.properties.outcome.enum.includes(value.outcome)) return null;
    for (const key of ['hints','concepts']) if (!Array.isArray(value[key]) || value[key].some(x => typeof x !== 'string')) return null;
    const card = Object.fromEntries(Object.keys(activitySchema.properties).map(key => [key, Array.isArray(value[key]) ? value[key].slice(0, key === 'hints' ? 3 : 4).map(v => v.slice(0, 2000)) : value[key].slice(0, key === 'body' ? 16000 : 2000)]));
    if (card.kind === 'challenge') { card.takeaway = ''; card.outcome = 'none'; }
    return card;
  } catch { return null; }
}
export function activityText(card) {
  return [card.title && `### ${card.title}`, card.body, card.question && `**${card.question}**`, card.takeaway && `Do zapamiętania: ${card.takeaway}`].filter(Boolean).join('\n\n');
}
export function publicMessage(message) {
  if (!message.card) return message;
  const { hints, ...card } = message.card;
  const isRecall = card.kind === 'challenge';
  return { ...message, card: { ...card, concepts: isRecall ? [] : card.concepts, hints: hints.slice(0, message.hintsUsed || 0), hintCount: hints.length } };
}
export const teachingProtocol = `
INTERFEJS NAUKI (ważniejsze niż domyślny format tekstowy skillu):
Końcowa odpowiedź to obiekt JSON według przekazanego schematu. To JEDNA aktywność dla człowieka, nie plan pracy agenta ani kompletna lekcja na raz. Nie dodawaj JSON do komentarzy w trakcie pracy; zwróć go dopiero na końcu.
kind:
- explain: krótki, konkretny model/obraz/przykład (zwykle do 120 słów), następnie jedno pytanie wymagające przewidywania, nie powtórzenia definicji;
- challenge: jeden realistyczny problem otwarty, transfer do nowego kontekstu albo znalezienie błędu. Bez rozwiązania i etykiet zdradzających zasady. Zwykle 2–3 powiązane pojęcia, jeśli uczeń zna składowe;
- feedback: odniesienie do KONKRETNEGO rozumowania człowieka: co zadziałało, gdzie model zawodzi i dlaczego. Nie recytuj całej teorii. question może zawierać jedną istotną korektę do wykonania albo być puste; wtedy UI oferuje Dalej;
- question: jedno pytanie konieczne do ustalenia celu/poziomu. Bez diagnozy każdej gałęzi i rytualnego zatwierdzania planu;
- summary: krótko, co wynika z realnych prób, co odłożono i jeden następny krok. Bez sztucznych punktów, procentów opanowania, serii i motywacyjnego wypełniacza.

title: krótki tytuł problemu, nie zdradzający odpowiedzi. body: Markdown, w razie potrzeby kod, KaTeX, mały mermaid. question: jedno pytanie do samodzielnej próby. hints: 0–3 STOPNIOWANE podpowiedzi, pierwsza orientuje uwagę, druga pokazuje fragment, trzecia przykład analogiczny. Nie umieszczaj rozwiązania docelowego w hints; pełne wyjaśnienie dopiero na prośbę lub po próbie. UI nie pokaże podpowiedzi, dopóki użytkownik o nie nie poprosi.
goal: stabilny cel całej sesji; focus: aktualna umiejętność, nazwana konsekwentnie między turami. concepts: pojęcia faktycznie ćwiczone (ukryte podczas challenge, widoczne w feedback). outcome: none bez oceny, independent tylko po samodzielnej poprawnej próbie, assisted gdy użyto podpowiedzi/przykładu, not_yet gdy brak dowodu. takeaway: zwięzła zasada ujawniana w informacji zwrotnej, nigdy rozwiązanie przed próbą. park: odłożony szczegół, albo pusty string.

PAMIĘĆ SESJI: Przy pełnej lekcji/powtórce korzystaj z .claude/skills/sesja/SKILL.md i scripts/session.mjs. Odczytaj status przy wznowieniu, zapisuj tylko rzeczywiste próby, uwzględniając hintsUsed. To pamięć wspólna z konsolą; nie uruchamiaj jej dla krótkiego pytania.

DOBÓR KOLEJNEGO KROKU:
Najpierw rozpoznaj, czy uczeń ma grunt do samodzielnego rozumowania. Gdy nie zna obszaru, daj explain. Gdy zna, zacznij od próby w kontekście. Poprawna samodzielna próba → inne zastosowanie, połączenie lub większa trudność. Częściowa odpowiedź → jedna celna informacja zwrotna. Dwie próby bez postępu → pokaż przykład, odłóż lukę (park) i zmień podejście/wątek; nie twórz trzeciego wariantu tej samej zagadki. Co kilka kroków wpleć wcześniejszy koncept w nową sytuację, bez zapowiedzi zasady. W trudnym zadaniu oceniaj rozumowanie, a nie domyślanie się intencji nauczyciela. Dopuszczaj alternatywne poprawne rozwiązania.
Próba z ujawnioną podpowiedzią nie jest niezależnym przypomnieniem. Historia podaje hintsUsed. Po feedback nie oceniaj FSRS ponownie tego samego pojęcia w tej sesji. Nie przyznawaj zbiorowego sukcesu wszystkim concepts, jeśli odpowiedź części z nich nie sprawdziła.
W tym interfejsie zadawaj problem w karcie zamiast otwierać dodatkowy quiz modalny. Zachowaj rytm problem → próba → informacja zwrotna → zastosowanie. Komendy użytkownika to intencje; nie pokazuj ich składni w treści nauki.
`;

export function learningState(messages) {
  const attempts = messages.filter(m => m.card && m.card.outcome !== 'none');
  const last = attempts.at(-1);
  let stalled = 0;
  for (const message of [...attempts].reverse()) {
    if (message.card.focus !== last?.card.focus || message.card.outcome !== 'not_yet') break;
    stalled++;
  }
  return {
    attempts: attempts.length,
    focus: last?.card.focus || '',
    stalled,
    next: stalled >= 2 ? 'explain-and-switch' : last?.card.outcome === 'independent' ? 'transfer-or-connect' : last?.card.outcome === 'assisted' ? 'new-independent-example' : 'adapt-to-answer',
  };
}
