export abstract class DomainException extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly httpStatus: number,
    message: string,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class EmailAlreadyExistsException extends DomainException {
  constructor() {
    super('EMAIL_ALREADY_EXISTS', 409, 'Email is already registered');
  }
}

export class InvalidCredentialsException extends DomainException {
  constructor() {
    super('INVALID_CREDENTIALS', 401, 'Invalid email or password');
  }
}

export class EmailNotConfirmedException extends DomainException {
  constructor() {
    super('EMAIL_NOT_CONFIRMED', 403, 'Email address has not been confirmed');
  }
}

export class InvalidTokenException extends DomainException {
  constructor() {
    super('INVALID_TOKEN', 401, 'Token is invalid');
  }
}

export class TokenExpiredException extends DomainException {
  constructor() {
    super('TOKEN_EXPIRED', 401, 'Token has expired');
  }
}

export class TokenReuseDetectedException extends DomainException {
  constructor() {
    super(
      'TOKEN_REUSE_DETECTED',
      401,
      'Token reuse detected — all sessions revoked',
    );
  }
}

// --- Video domain (Phase 03) ---

export class VideoNotFoundException extends DomainException {
  constructor() {
    super('VIDEO_NOT_FOUND', 404, 'Video not found');
  }
}

export class NotVideoOwnerException extends DomainException {
  constructor() {
    super('NOT_VIDEO_OWNER', 403, 'You do not own this resource');
  }
}

export class FileTooLargeException extends DomainException {
  constructor() {
    super('FILE_TOO_LARGE', 413, 'File exceeds the maximum allowed size');
  }
}

export class UploadNotInitiatedException extends DomainException {
  constructor() {
    super(
      'UPLOAD_NOT_INITIATED',
      409,
      'Upload has not been initiated for this video',
    );
  }
}

export class UploadAlreadyCompletedException extends DomainException {
  constructor() {
    super('UPLOAD_ALREADY_COMPLETED', 409, 'Upload has already been completed');
  }
}

export class InvalidStatusTransitionException extends DomainException {
  constructor() {
    super('INVALID_STATUS_TRANSITION', 409, 'Invalid status transition');
  }
}
