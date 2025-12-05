const mongoose = require('mongoose');
const { google } = require('googleapis');

const CourseSchema = new mongoose.Schema({
  // --- Google Classroom由来のデータ ---
  googleCourseId: { 
    type: String, 
    required: true, 
    unique: true 
  },
  name: { type: String, required: true }, // 例: "3年B組 数学II"
  section: { type: String }, // 例: "1学期"
  descriptionHeading: { type: String },
  
  // クラスへのディープリンク（Classroomアプリに飛べるようにすると便利）
  alternateLink: { type: String },

  // --- SNS運用上のデータ ---
  // メンバー（Userモデルへの参照）
  members: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  
  // このクラスの担任・管理者（Userモデルへの参照）
  teachers: [{ 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'User' 
  }],
  
  ownerId: {
    type: String
  },

  school : {
    type : String,
  },
  
  // 最終同期日時（API制限対策：頻繁にGoogleに見に行かないため）
  lastSyncedAt: { type: Date, default: Date.now }

}, { timestamps: true });

module.exports = mongoose.model('Course', CourseSchema);