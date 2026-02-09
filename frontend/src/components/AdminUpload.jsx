import {useDropzone} from "react-dropzone"
import axios from "axios"

export default function AdminUpload(){

 const onDrop=files=>{
  files.forEach(f=>{
   const reader=new FileReader()
   reader.onload=()=>{
    axios.post("/api/image",{base64:reader.result.split(",")[1]})
   }
   reader.readAsDataURL(f)
  })
 }

 const{getRootProps,getInputProps}=useDropzone({onDrop,accept:{"image/*":[]}})

 return(
 <div {...getRootProps()} className="border p-10 text-center cursor-pointer">
   <input {...getInputProps()}/>
   Drag & Drop Upload
 </div>
 )
}
