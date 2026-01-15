import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import './ranking.css';
import Topbar from '../../components/topbar/topbarMain';
import Sidebar from '../../components/sidebar/sidebar';
import { TrendingUp, Tag } from '@mui/icons-material';
import Bottombar from '../../components/bottombar/bottombar';

export default function Ranking() {
    const [trending, setTrending] = useState([]);
    const [loading, setLoading] = useState(true);
    const navigate = useNavigate();

    useEffect(() => {
        const fetchTrending = async () => {
            try {
                const res = await axios.get('/api/hashtags/trending');
                setTrending(res.data);
            } catch (err) {
                console.error('Failed to fetch trending hashtags:', err);
            } finally {
                setLoading(false);
            }
        };
        fetchTrending();
    }, []);

    const handleHashtagClick = (tag) => {
        navigate(`/search?q=${encodeURIComponent('#' + tag)}`);
    };

    return (
        <>
            <Topbar />
            <div className="rankingContainer">
                <Sidebar />
                <div className="rankingMain">
                    <div className="rankingHeader">
                        <TrendingUp className="rankingIcon" />
                        <h2>トレンドランキング</h2>
                    </div>
                    <p className="rankingSubtitle">本日のトレンドハッシュタグ</p>

                    {loading ? (
                        <div className="rankingLoading">読み込み中...</div>
                    ) : trending.length === 0 ? (
                        <div className="rankingEmpty">
                            <Tag className="emptyIcon" />
                            <p>まだトレンドのハッシュタグがありません</p>
                            <p className="emptyHint">投稿に #ハッシュタグ を付けてみましょう！</p>
                        </div>
                    ) : (
                        <ul className="rankingList">
                            {trending.map((item) => (
                                <li
                                    key={item.tag}
                                    className="rankingItem"
                                    onClick={() => handleHashtagClick(item.tag)}
                                >
                                    <span className="rankNumber">{item.rank}</span>
                                    <div className="rankContent">
                                        <span className="rankTag">#{item.tag}</span>
                                        <span className="rankCount">{item.count} 投稿</span>
                                    </div>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </div>
            <Bottombar />
        </>
    );
}
