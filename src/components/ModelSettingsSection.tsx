import {
  FEATURE_MODELS,
  TIER_MODELS,
  resolveOperationModel,
  type ModelSettings,
  type ModelTier,
  type FeatureKey,
  type TextFeatureKey,
} from '../services/models';

const TIER_LABELS: Record<ModelTier, string> = {
  flashLite: 'Flash-Lite — fastest & cheapest',
  flash: 'Flash — balanced',
  pro: 'Pro — flagship quality',
};

const OPERATION_LABELS: Record<TextFeatureKey, string> = {
  narration: 'Narration script',
  transcription: 'Voiceover transcription',
  videoAnalysis: 'Video analysis',
  clipAlignment: 'Clip alignment',
  description: 'Description & chapters',
  thumbnails: 'Thumbnail key moments',
};

const SELECT_CLASS =
  'text-sm border border-gray-200 rounded-xl px-3 py-2 bg-white text-gray-700 focus:outline-none focus:ring-2 focus:ring-violet-300';

const TIERS = Object.keys(TIER_MODELS) as ModelTier[];
// Every registry feature is tunable except TTS, whose model is audio-only.
const OPERATIONS = (Object.keys(FEATURE_MODELS) as FeatureKey[]).filter(
  (f): f is TextFeatureKey => f !== 'tts'
);

interface Props {
  settings: ModelSettings;
  onChange: (next: ModelSettings) => void;
}

/**
 * Model-selection settings: a default tier applied to every text operation,
 * plus a per-operation override. Resolution itself is registry-backed
 * (resolveOperationModel); this component only edits the settings.
 */
export function ModelSettingsSection({ settings, onChange }: Props) {
  const setOverride = (operation: TextFeatureKey, tier: ModelTier | undefined) => {
    const overrides = { ...settings.overrides };
    if (tier) {
      overrides[operation] = tier;
    } else {
      delete overrides[operation];
    }
    onChange({ ...settings, overrides });
  };

  return (
    <div className="border-t border-gray-100 pt-5 mt-5">
      <h3 className="text-sm font-bold text-gray-900">Model selection</h3>
      <p className="text-xs text-gray-400 mt-1 mb-3">
        Flash-Lite and Flash are fast and cheap; Pro is the flagship reasoning model.
        Covers text features — speech always uses the TTS model.
      </p>
      <label className="block mb-3">
        <span className="text-xs font-semibold text-gray-500 block mb-1">
          Default for all operations
        </span>
        <select
          className={SELECT_CLASS + ' w-full'}
          value={settings.defaultTier ?? ''}
          onChange={e => onChange({ ...settings, defaultTier: e.target.value ? (e.target.value as ModelTier) : undefined })}
        >
          <option value="">Per-operation defaults</option>
          {TIERS.map(tier => (
            <option key={tier} value={tier}>{TIER_LABELS[tier]}</option>
          ))}
        </select>
      </label>
      <div className="space-y-2">
        {OPERATIONS.map(operation => {
          const override = settings.overrides?.[operation];
          return (
            <label key={operation} className="flex items-center justify-between gap-3">
              <span className="text-xs text-gray-600 flex-1 min-w-0">
                {OPERATION_LABELS[operation]}
                <span className="block text-[10px] text-gray-300 font-mono truncate">
                  {resolveOperationModel(settings, operation)}
                </span>
              </span>
              <select
                className={SELECT_CLASS + ' w-44 shrink-0'}
                value={override ?? ''}
                onChange={e => setOverride(operation, e.target.value ? (e.target.value as ModelTier) : undefined)}
              >
                <option value="">Default</option>
                {TIERS.map(tier => (
                  <option key={tier} value={tier}>{TIER_LABELS[tier]}</option>
                ))}
              </select>
            </label>
          );
        })}
      </div>
    </div>
  );
}
