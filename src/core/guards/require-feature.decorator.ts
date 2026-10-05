import { SetMetadata } from '@nestjs/common';

export const REQUIRE_FEATURE_KEY = 'requireFeature';

/** Exige que el plan del tenant tenga habilitada la feature indicada. */
export const RequireFeature = (clave: string) => SetMetadata(REQUIRE_FEATURE_KEY, clave);
