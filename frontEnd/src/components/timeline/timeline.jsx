import React, { useEffect, useState} from 'react'
// import React from 'react'
import './timeline.css'
import Share from '../share/share'
import Post from '../post/post'
//import { Posts } from '../../dummyData'
import axios from 'axios'
import { AuthContext } from '../../state/AuthContext'
import { useContext } from 'react'




export default function Timeline( {username} ) {
  const [ posts, setPosts ] = useState([]);
  const {user} = useContext(AuthContext)

  useEffect(() => {
    const fetchPosts = async () => {
      const response = username 
      ? await axios.get(`/posts/profile/${username}`)
      : await axios.get("/posts/timeline/all");
      setPosts(response.data);
    }
    fetchPosts();
  }, [ username , user?._id ]);

  return (
    <div className='timeline'>
      <div className="timelineWrapper">
        {user && (!username || username === user.username) && <Share className="Share"/>}
        {posts.map((post) => (
          <Post post={post} key={post._id}/>
        ))}
      </div>
    </div>
  )
}
