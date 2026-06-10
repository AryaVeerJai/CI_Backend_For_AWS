const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true
  },
  password: {
    type: String,
    required: true,
    minlength: 6
  },
  role: {
    type: String,
    enum: ['admin', 'view', 'msme', 'enterprise', 'partner'],
    default: 'msme'
  },
  isActive: {
    type: Boolean,
    default: true
  },
  lastLogin: {
    type: Date
  },
  profile: {
    firstName: String,
    lastName: String,
    phone: String,
    avatar: String
  },
  accessCredentials: {
    organizationType: {
      type: String,
      enum: ['government_accredited_auditor', 'bank_incentives_partner', 'verification_agency', 'other']
    },
    organizationName: {
      type: String,
      trim: true
    },
    credentialId: {
      type: String,
      trim: true
    },
    accessPurpose: {
      type: String,
      trim: true
    },
    approvedBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User'
    },
    approvedAt: {
      type: Date
    }
  },
  resetPasswordToken: {
    type: String,
    default: null
  },
  resetPasswordExpires: {
    type: Date,
    default: null
  }
}, {
  timestamps: true
});

// Hash password before saving
userSchema.pre('save', async function (next) {
  if (!this.isModified('password')) return next();

  try {
    const salt = await bcrypt.genSalt(10);
    this.password = await bcrypt.hash(this.password, salt);
    next();
  } catch (error) {
    next(error);
  }
});

const isBcryptHash = (value) => (
  typeof value === 'string'
  && (value.startsWith('$2a$') || value.startsWith('$2b$') || value.startsWith('$2y$'))
);

// Compare password method (supports legacy plaintext hashes from manual DB edits)
userSchema.methods.comparePassword = async function (candidatePassword) {
  const storedPassword = this.password;
  if (!storedPassword) {
    return false;
  }

  if (isBcryptHash(storedPassword)) {
    return bcrypt.compare(candidatePassword, storedPassword);
  }

  return storedPassword === candidatePassword;
};

userSchema.methods.hasBcryptPassword = function hasBcryptPassword() {
  return isBcryptHash(this.password);
};

userSchema.methods.upgradeLegacyPassword = async function upgradeLegacyPassword(plainPassword) {
  if (isBcryptHash(this.password)) {
    return false;
  }

  const salt = await bcrypt.genSalt(10);
  const hashedPassword = await bcrypt.hash(plainPassword, salt);
  await this.constructor.updateOne({ _id: this._id }, { password: hashedPassword });
  this.password = hashedPassword;
  return true;
};

userSchema.pre('save', function clearCredentialsForNonView(next) {
  if (this.role !== 'view' && this.accessCredentials) {
    this.accessCredentials = undefined;
  }
  next();
});

module.exports = mongoose.model('User', userSchema);