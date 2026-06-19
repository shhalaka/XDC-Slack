import { SetMetadata } from '@nestjs/common';

export const SKIP_TRANSFORM = 'skip_transform';
export const SkipTransform = () => SetMetadata(SKIP_TRANSFORM, true);
