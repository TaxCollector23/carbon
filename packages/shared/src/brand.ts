declare const brand: unique symbol;

export type Brand<T, B extends string> = T & { readonly [brand]: B };

export type ProjectId = Brand<string, 'ProjectId'>;
export type RecordingId = Brand<string, 'RecordingId'>;
export type EmulatorId = Brand<string, 'EmulatorId'>;
export type UserId = Brand<string, 'UserId'>;
