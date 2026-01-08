import React, { useEffect, useState, useContext } from 'react'
import './timeline.css'
import Share from '../share/share'
import Post from '../post/post'
import axios from 'axios'
import { AuthContext } from '../../state/AuthContext'
import { Refresh, School } from '@mui/icons-material' // School icon for Classroom

export default function Timeline({ username }) {
  const [posts, setPosts] = useState([]);
  const [announcements, setAnnouncements] = useState([]);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const { user } = useContext(AuthContext)

  const fetchPosts = async () => {
    try {
      setIsRefreshing(true);
      const response = username
        ? await axios.get(`/api/posts/profile/${username}`)
        : await axios.get("/api/posts/timeline/all");
      setPosts(response.data);
    } catch (err) {
      console.log(err);
    } finally {
      setTimeout(() => setIsRefreshing(false), 500);
    }
  }

  const handleClassroomSync = async (isAuto = false) => {
    try {
      const token = localStorage.getItem('token');
      if (!token) {
        if (!isAuto) alert("Google Classroomと同期するには、Googleでのログインが必要です。");
        return;
      }

      setIsSyncing(true);
      const res = await axios.get('/api/classroom/announcements', {
        headers: { Authorization: `Bearer ${token}` }
      });

      // アナウンスメントをPostコンポーネントが扱える形式に変換
      const formattedAnnouncements = res.data.map(item => ({
        _id: item.id,
        desc: `[Classroom: ${item.courseName}] ${item.text || "No content"}`,
        img: null,
        createdAt: item.updateTime,
        userId: {
          username: "Google Classroom",
          profilePicture: "https://upload.wikimedia.org/wikipedia/commons/5/59/Google_Classroom_Logo.png", // 仮のアイコン
          _id: "google_classroom_bot"
        },
        likes: [],
        comment: 0,
        isClassroom: true,
        courseLink: item.courseLink
      }));

      setAnnouncements(formattedAnnouncements);
    } catch (err) {
      console.error("Classroom sync error:", err);
      // 自動同期の場合はアラートを出さない
      if (!isAuto) {
        if (err.response && err.response.status === 401) {
          alert("Google認証の有効期限が切れている可能性があります。再ログインしてください。");
        } else {
          alert("Classroomデータの取得に失敗しました。");
        }
      }
    } finally {
      setIsSyncing(false);
    }
  };

  useEffect(() => {
    fetchPosts();
    // タイムライン（ホーム）でのみ自動同期を実行
    if (!username) {
      handleClassroomSync(true);
    }
  }, [username, user?._id]);

  const handleRefresh = () => {
    fetchPosts();
    if (!username) {
      handleClassroomSync(true);
    }
  };

  // 投稿とアナウンスメントをマージ（4投稿に1回アナウンスメント）
  const getCombinedPosts = () => {
    if (announcements.length === 0) return posts;

    let combined = [...posts];
    let announceIdx = 0;

    // 4投稿ごとに挿入 (index: 4, 9, 14...)
    for (let i = 4; i < combined.length + announcements.length; i += 5) {
      if (announceIdx < announcements.length) {
        combined.splice(i, 0, announcements[announceIdx]);
        announceIdx++;
      } else {
        break;
      }
    }

    return combined;
  };

  const displayPosts = getCombinedPosts();

  return (
    <div className='timeline'>
      <div className="timelineWrapper">
        <div className="timelineHeader">
          <div className="timelineHeaderButtons">
            <div
              className={`refreshButton ${isRefreshing ? 'refreshing' : ''}`}
              onClick={handleRefresh}
              title="Refresh Timeline"
            >
              <Refresh className="refreshIcon" />
              <span className="refreshText">New Posts</span>
            </div>
            {/* Sync Button */}
            {!username && ( // プロフィールページ以外でのみ表示
              <div
                className={`refreshButton syncButton ${isSyncing ? 'syncing' : ''}`}
                onClick={handleClassroomSync}
                title="Sync with Google Classroom"
                style={{ marginLeft: '10px' }}
              >
                <School className="refreshIcon" />
                <span className="refreshText">Sync Class</span>
              </div>
            )}
          </div>
        </div>

        {user && (!username || username === user.username) && <Share className="Share" />}
        {displayPosts.map((post) => (
          <Post post={post} key={post._id} />
        ))}
      </div>
    </div>
  )
}
