/**
 * The strategy engine's wire contract, mirrored from
 * `src/strategy/spec/strategy.types.ts` in the backend repo.
 *
 * Hand-mirrored rather than generated, exactly as `chart-stream.models.ts` is,
 * and the same rule applies: when the backend changes one of these shapes, this
 * file changes with it in the same breath. The doc comments here are the ones a
 * frontend needs — what a field means for rendering — not a copy of the
 * backend's reasoning.
 */

/**
 * One tunable number, with the bounds that make it tunable safely.
 *
 * `description` is what tells a reader — or an analysis proposing a change —
 * why moving this number would do anything, so it is worth showing as help text
 * rather than hiding.
 */
export interface StrategyParamSpec {
  key: string;
  label: string;
  description: string;
  min: number;
  max: number;
  step: number;
  integer: boolean;
}

/** A strategy the backend can run. Authored in code; there is no create endpoint. */
export interface StrategyDescriptor {
  id: string;
  name: string;
  description: string;
  /**
   * Whether the strategy needs the bars to carry **volume**.
   *
   * Load-bearing rather than documentation: an index carries none — not little,
   * none — so a volume-weighted strategy pointed at one never warms up and
   * takes zero trades, which reads as a quiet month rather than as the mismatch
   * it is. The backtest tab filters on this so the pairing cannot be made by
   * accident, and the backend refuses it too.
   *
   * Stated as a requirement rather than as a kind of instrument, so an equity —
   * which is neither an index nor an option, and does carry volume — needs no
   * new case anywhere.
   */
  requiresVolume: boolean;
  /** Bar size the strategy reasons on. The chart's own interval is independent. */
  timeframeMinutes: number;
  /** Bars it needs before its first real decision — why history matters. */
  warmupBars: number;
  /** The bounds every override is checked against. */
  paramSpecs: StrategyParamSpec[];
  /** The defaults an override is merged onto. */
  params: Record<string, number>;
}
