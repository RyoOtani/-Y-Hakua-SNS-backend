import React, { useState, useEffect } from "react";
import { useLocation, Link } from "react-router-dom";
import Topbar from "../../components/topbar/topbarMain";
import Sidebar from "../../components/sidebar/sidebar";
import Rightbar from "../../components/rightbar/rightbar";
import Bottombar from "../../components/bottombar/bottombar";
import Post from "../../components/post/post";
import './search_result.css'
// import { CommentBankSharp } from "@mui/icons-material";

function SearchResults() {
  const [users, setUsers] = useState([]);
  const [posts, setPosts] = useState([]);
  const [loading, setLoading] = useState(false);
  const location = useLocation();

  const getQueryParam = (key) => {
    const params = new URLSearchParams(location.search);
    return params.get(key) || "";
  };
  const [currentQuery, setCurrentQuery] = useState(getQueryParam("q"));

  // const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  //→ ここで /api/users/search と /api/posts/search を叩く
  const handleSearch = async (query) => {
    const q = (query || "").toString().trim();
    setCurrentQuery(q);
    if (!q) {
      setUsers([]);
      setPosts([]);
      return;
    }
    setLoading(true);
    try {
      const userReq = fetch(`/api/users/search?q=${encodeURIComponent(q)}`);
      const postReq = fetch(`/api/posts/search?q=${encodeURIComponent(q)}`);
      const [userRes, postRes] = await Promise.all([userReq, postReq]);

      if (userRes.ok) setUsers(await userRes.json());
      else {
        console.error("users API error:", userRes.status, await userRes.text());
        setUsers([]);
      }

      if (postRes.ok) {
        const data = await postRes.json();
        setPosts(Array.isArray(data) ? data : []);
        console.log(posts);
      } else {
        console.error("posts API error:", postRes.status, await postRes.text());
        setPosts([]);
      }
    } catch (err) {
      console.error("search fetch error:", err);
      setUsers([]);
      setPosts([]);
    } finally {
      setLoading(false);
    }
  };
  // const handleSearch = async (query) => {
  // const q = (query || "").trim();
  // setCurrentQuery(q);
  // if (!q) {
  //   setUsers([]);
  //   setPosts([]);
  //   return;
  // }


  // setLoading(true);
  // try {
  //   const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
  //   if (!res.ok) throw new Error("search failed");
  //   const data = await res.json();
  //   setUsers(data.users || []);
  //   setPosts(data.posts || []);
  // } catch (err) {
  //   console.error(err);
  //   setUsers([]);
  //   setPosts([]);
  // } finally {
  //   setLoading(false);
  // }
  // };

  useEffect(() => {
    const q = getQueryParam("q");
    setCurrentQuery(q);
    if (q) handleSearch(q);
    else {
      setUsers([]);
      setPosts([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.search]);

  const PUBLIC_FOLDER = process.env.REACT_APP_PUBLIC_FOLDER || "/images";

  return (
    <div className="p-4">
      <Topbar onSearch={handleSearch} initialValue={getQueryParam("q")} />
      <div className="seachResultContainer">
        <div className="sidebar"><Sidebar /></div>
        <div className="SearchResultRightConteiner">
          <div className="searchResultSpace">
            {currentQuery ? (
              <h2 className="mt-4 text-xl">検索結果: 「{currentQuery}」</h2>
            ) : (
              <h2 className="mt-4 text-xl">検索ワードを入力してください</h2>
            )}

            {loading ? (
              <p>検索中...</p>
            ) : (
              <>
                <section className="mt-4">
                  <h3>ユーザー ({users.length})</h3>
                  <ul>
                    {users.map((user) => (
                      <li key={user._id} className="border-b_py-2">
                        <Link to={`/profile/${user.username}`} style={{ display: "flex", alignItems: "center", textDecoration: "none", color: "inherit" }}>
                          <img
                            src={
                              user.profilePicture
                                ? user.profilePicture.startsWith("http")
                                  ? user.profilePicture
                                  : PUBLIC_FOLDER + (user.profilePicture.startsWith("/assets/") ? user.profilePicture.replace("/assets/", "") : user.profilePicture)
                                : PUBLIC_FOLDER + "person/noAvatar.png"
                            }
                            alt=""
                            style={{ width: 36, height: 36, borderRadius: "50%", marginRight: 8, objectFit: "cover" }}
                          />
                          <div>
                            <div>{user.name || user.username}</div>
                            <div className="text-sm text-gray-500">{user.username ? `@${user.username}` : ""}</div>
                          </div>
                        </Link>
                      </li>
                    ))}
                    {users.length === 0 && <p>ユーザーは見つかりませんでした</p>}
                  </ul>
                </section>

                <section className="mt-6">
                  <h3>投稿 ({posts.length})</h3>
                  
                  {/* <ul> タグは、Postコンポーネントのデザインによっては
                    レイアウトが崩れる可能性があるため、 
                    <div> に変更することを推奨します。
                  */}
                  <div className="postResultsList"> {/* <ul> の代わり */}
                    
                    {/* ▼ 2. ここを変更 ▼ */}
                    {posts.map((post) => (
                      // 既存のPostコンポーネントを呼び出し、
                      // postオブジェクトをそのまま "post" prop として渡す
                      <Post key={post._id} post={post} />
                    ))}
                    {/* ▲ 変更ここまで ▲ */}

                    {posts.length === 0 && <p>投稿は見つかりませんでした</p>}
                  </div>
                </section>
              </>
            )}
            
          </div>
          <Rightbar/>
        </div>
      </div>
      <div className="bottombar">
        <Bottombar/>
      </div>

    </div>
  );
}
export default SearchResults;
// import React, { useState, useEffect } from 'react';
// import axios from 'axios';
// // ▼ 追加 ▼
// // あなたが普段、投稿を1件表示するために使っているコンポーネントをインポート
// import Post from '../../components/post/post'

// const SearchResults = () => {
//   const [searchTerm, setSearchTerm] = useState('');
//   const [results, setResults] = useState([]); // ここにPostオブジェクトの配列が入る
//   const [loading, setLoading] = useState(false);

//   useEffect(() => {
//     // (デバウンス処理とAPIリクエスト部分は前回と同じ)
//     // ...
//     const delayDebounceFn = setTimeout(async () => {
//       if (searchTerm.trim() === '') {
//         setResults([]);
//         setLoading(false);
//         return;
//       }
//       setLoading(true);
//       try {
//         const res = await axios.get(`/api/posts/search?q=${searchTerm}`);
//         // res.data には [post1, post2, ...] が入っている
//         setResults(res.data);
//       } catch (err) {
//         console.error('検索エラー:', err);
//       } finally {
//         setLoading(false);
//       }
//     }, 500);

//     return () => clearTimeout(delayDebounceFn);

//   }, [searchTerm]);

//   return (
//     <div>
//       <input
//         type="text"
//         placeholder="投稿を検索..."
//         value={searchTerm}
//         onChange={(e) => setSearchTerm(e.target.value)}
//         className="search-input"
//       />

//       <div className="search-results">
//         {loading && <p>検索中...</p>}
        
//         {!loading && results.length === 0 && searchTerm.trim() !== '' && (
//           <p>検索結果はありません。</p>
//         )}

//         {/* ▼ ここが重要 ▼
//             results (投稿オブジェクトの配列) を .map() でループ処理し、
//             1件ずつ PostItem コンポーネントに props として渡す */}
//         {!loading && results.length > 0 && (
//           results.map(post => (
//             <Post key={post._id} post={post} />
//           ))
//         )}
//       </div>
//     </div>
//   );
// };

// // export default Search;


