// Classifier contracts + pure prompt/parse helpers shared by web and gateway.

export interface ClassifierDimension {
  name: string;
  values: string[];
}

export const MAX_CLASSIFIERS = 10;
export const MAX_DIMENSIONS = 8;

export interface ClassifierPreset {
  id: string;
  label: string;
  description: string;
  dimensions: ClassifierDimension[];
  prompt: string;
}

export const CLASSIFIER_PRESETS: ClassifierPreset[] = [
  {
    id: 'department',
    label: 'Department',
    description: 'Route requests to the internal department they relate to.',
    dimensions: [
      {
        name: 'department',
        values: ['Engineering', 'Sales', 'Marketing', 'Support', 'Finance', 'HR', 'Legal', 'Operations'],
      },
    ],
    prompt: 'Determine which internal department this request most relates to.',
  },
  {
    id: 'audience',
    label: 'Audience',
    description: 'Identify who the response is intended for.',
    dimensions: [{ name: 'audience', values: ['Internal', 'Customer', 'Developer', 'Executive', 'General public'] }],
    prompt: 'Determine the primary audience for this request.',
  },
  {
    id: 'engineering',
    label: 'Engineering work',
    description: 'Categorize the type of engineering work involved.',
    dimensions: [
      {
        name: 'engineering_work',
        values: ['Feature', 'Bug fix', 'Refactor', 'Documentation', 'Testing', 'Infrastructure', 'Research'],
      },
    ],
    prompt: 'Classify the type of engineering work this request represents.',
  },
  {
    id: 'agent_complexity',
    label: 'Agent complexity',
    description: 'Estimate the complexity of the agentic task.',
    dimensions: [{ name: 'complexity', values: ['Trivial', 'Simple', 'Moderate', 'Complex', 'Very complex'] }],
    prompt: 'Estimate how complex the task in this request is for an AI agent to complete.',
  },
  {
    id: 'task_type',
    label: 'Task type',
    description: 'Classify the kind of task being requested.',
    dimensions: [
      {
        name: 'task_type',
        values: ['Coding', 'Writing', 'Analysis', 'Q&A', 'Summarization', 'Translation', 'Extraction', 'Other'],
      },
    ],
    prompt: 'Classify the kind of task the user is asking for.',
  },
  {
    id: 'capitalizable',
    label: 'Capitalizable software expense',
    description: 'Flag whether the work may be a capitalizable software expense.',
    dimensions: [{ name: 'capitalizable', values: ['Capitalizable', 'Non-capitalizable', 'Uncertain'] }],
    prompt:
      'Determine whether the work described could be classified as a capitalizable software development expense (new features or capabilities) versus non-capitalizable (maintenance, bug fixes, research).',
  },
  {
    id: 'custom',
    label: 'Custom',
    description: 'Start from a blank classifier and define your own dimensions.',
    dimensions: [],
    prompt: '',
  },
];

export function classifierPreset(id: string): ClassifierPreset | undefined {
  return CLASSIFIER_PRESETS.find((p) => p.id === id);
}

function sanitizeDimensions(dimensions: ClassifierDimension[]): ClassifierDimension[] {
  return dimensions
    .map((d) => ({ name: d.name.trim(), values: d.values.map((v) => v.trim()).filter(Boolean) }))
    .filter((d) => d.name && d.values.length > 0);
}

// Builds a deterministic classification prompt. The model is asked to return a
// strict JSON object mapping each dimension name to exactly one of its values.
export function buildClassifierPrompt(
  dimensions: ClassifierDimension[],
  instructions: string,
  conversation: string,
): { system: string; user: string } {
  const dims = sanitizeDimensions(dimensions);
  const schema = dims.map((d) => `- "${d.name}": one of [${d.values.map((v) => `"${v}"`).join(', ')}]`).join('\n');
  const system = [
    'You are a precise text classifier.',
    instructions.trim() ? `Task: ${instructions.trim()}` : '',
    'Classify the conversation along the following dimensions:',
    schema,
    '',
    'Respond with ONLY a single minified JSON object mapping each dimension name to exactly one allowed value.',
    'If a dimension cannot be determined, use the string "unknown".',
    'Do not include any commentary, code fences, or extra keys.',
  ]
    .filter(Boolean)
    .join('\n');
  const user = `Conversation to classify:\n"""\n${conversation}\n"""`;
  return { system, user };
}

// Parses model output into validated { dimensionName: value }. Values not in the
// allowed set (other than "unknown") are coerced to "unknown".
export function parseClassifierOutput(
  text: string,
  dimensions: ClassifierDimension[],
): Record<string, string> {
  const dims = sanitizeDimensions(dimensions);
  const out: Record<string, string> = {};
  let parsed: Record<string, unknown> = {};
  const match = text.match(/\{[\s\S]*\}/);
  if (match) {
    try {
      parsed = JSON.parse(match[0]) as Record<string, unknown>;
    } catch {
      parsed = {};
    }
  }
  for (const d of dims) {
    const raw = parsed[d.name];
    const val = typeof raw === 'string' ? raw.trim() : '';
    const allowed = d.values.find((v) => v.toLowerCase() === val.toLowerCase());
    out[d.name] = allowed ?? 'unknown';
  }
  return out;
}
