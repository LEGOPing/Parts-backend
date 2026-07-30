//
//  ColorManagementView.swift
//  PARTS
//
//  Created by Guo Ping Hu on 2026/2/14.
//

import SwiftUI
import CoreData

struct ColorManagementView: View {
    @Environment(\.managedObjectContext) private var viewContext
    @Binding var currentState: ViewState
    @State private var showAddColorSheet = false
    @State private var showEditColorSheet = false
    @State private var selectedColor: NSManagedObject?
    @State private var colorName = ""
    @State private var rgb = ""
    @State private var bricklinkId: Int32 = 0

    // 手动获取所有颜色
    private func getAllColors() -> [NSManagedObject] {
        var result: [NSManagedObject] = []
        let fetchRequest = NSFetchRequest<NSManagedObject>(entityName: "Color")
        fetchRequest.sortDescriptors = [NSSortDescriptor(key: "colorName", ascending: true)]
        do {
            result = try viewContext.fetch(fetchRequest)
        } catch {
            print("Error fetching colors: \(error)")
        }
        return result
    }

    var body: some View {
        VStack {
            // 顶部栏
            HStack {
                Button(action: {
                    showAddColorSheet.toggle()
                }) {
                    Text("添加颜色")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.blue)
                        .cornerRadius(8)
                }
                Spacer()
                Button(action: {
                    currentState = .settings
                }) {
                    Text("退回上一级")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundColor(.white)
                        .padding(.horizontal, 16)
                        .padding(.vertical, 8)
                        .background(Color.gray)
                        .cornerRadius(8)
                }
            }
            .padding(.horizontal, 20)
            
            // 标题
            Text("颜色管理")
                .font(.system(size: 24, weight: .bold))
                .padding()
            
            // 颜色列表
            ScrollView {
                LazyVGrid(columns: Array(repeating: GridItem(.flexible()), count: 3), spacing: 20) {
                    ForEach(getAllColors(), id: \.objectID) { color in
                        VStack(alignment: .leading, spacing: 8) {
                            // ID
                            let colorId = color.objectID.hashValue % 10000
                            Text("ID: \(colorId)")
                                .font(.system(size: 12))
                                .foregroundColor(.gray)
                            
                            // 颜色名称
                            let colorNameValue = color.value(forKey: "colorName") as? String ?? "未命名颜色"
                            Text(colorNameValue)
                                .font(.system(size: 16, weight: .bold))
                                .foregroundColor(.white)
                            
                            // RGB值
                            let rgbValue = color.value(forKey: "rgb") as? String ?? ""
                            Text("RGB: \(rgbValue)")
                                .font(.system(size: 12))
                                .foregroundColor(.white)
                            
                            // Bricklink ID
                            let bricklinkIdValue = color.value(forKey: "bricklinkId") as? Int32 ?? 0
                            Text("Bricklink ID: \(bricklinkIdValue)")
                                .font(.system(size: 12))
                                .foregroundColor(.white)
                        }
                        .padding()
                        .background(Color.gray)
                        .cornerRadius(8)
                        .contextMenu {
                            Button(action: {
                                selectedColor = color
                                colorName = color.value(forKey: "colorName") as? String ?? ""
                                rgb = color.value(forKey: "rgb") as? String ?? ""
                                bricklinkId = color.value(forKey: "bricklinkId") as? Int32 ?? 0
                                showEditColorSheet.toggle()
                            }) {
                                Text("编辑")
                            }
                            Button(action: {
                                deleteColor(color)
                            }) {
                                Text("删除")
                            }
                        }
                    }
                }
                .padding()
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color.white)
        .sheet(isPresented: $showAddColorSheet) {
            VStack {
                Text("添加颜色")
                    .font(.system(size: 18, weight: .bold))
                    .padding()
                TextField("颜色名称", text: $colorName)
                    .font(.system(size: 16))
                    .padding()
                    .border(Color.gray.opacity(0.3))
                    .cornerRadius(4)
                    .padding(.horizontal, 40)
                TextField("RGB值", text: $rgb)
                    .font(.system(size: 16))
                    .padding()
                    .border(Color.gray.opacity(0.3))
                    .cornerRadius(4)
                    .padding(.horizontal, 40)
                HStack {
                    Text("Bricklink ID:")
                        .font(.system(size: 16))
                        .padding()
                    Spacer()
                    TextField("", value: $bricklinkId, formatter: NumberFormatter())
                        .font(.system(size: 16))
                        .padding()
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(4)
                        .padding(.horizontal, 40)
                }
                HStack {
                    Button(action: {
                        showAddColorSheet = false
                        resetForm()
                    }) {
                        Text("取消")
                            .font(.system(size: 16))
                            .foregroundColor(.red)
                            .padding()
                    }
                    Spacer()
                    Button(action: {
                        addColor()
                    }) {
                        Text("确定")
                            .font(.system(size: 16))
                            .foregroundColor(.blue)
                            .padding()
                    }
                }
                .padding()
            }
            .padding()
        }
        .sheet(isPresented: $showEditColorSheet) {
            if let color = selectedColor {
                VStack {
                    Text("编辑颜色")
                        .font(.system(size: 18, weight: .bold))
                        .padding()
                    TextField("颜色名称", text: $colorName)
                        .font(.system(size: 16))
                        .padding()
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(4)
                        .padding(.horizontal, 40)
                    TextField("RGB值", text: $rgb)
                        .font(.system(size: 16))
                        .padding()
                        .border(Color.gray.opacity(0.3))
                        .cornerRadius(4)
                        .padding(.horizontal, 40)
                    HStack {
                        Text("Bricklink ID:")
                            .font(.system(size: 16))
                            .padding()
                        Spacer()
                        TextField("", value: $bricklinkId, formatter: NumberFormatter())
                            .font(.system(size: 16))
                            .padding()
                            .border(Color.gray.opacity(0.3))
                            .cornerRadius(4)
                            .padding(.horizontal, 40)
                    }
                    HStack {
                        Button(action: {
                            showEditColorSheet = false
                            resetForm()
                        }) {
                            Text("取消")
                                .font(.system(size: 16))
                                .foregroundColor(.red)
                                .padding()
                        }
                        Spacer()
                        Button(action: {
                            updateColor(color)
                        }) {
                            Text("确定")
                                .font(.system(size: 16))
                                .foregroundColor(.blue)
                                .padding()
                        }
                    }
                    .padding()
                }
                .padding()
            }
        }
    }

    private func addColor() {
        withAnimation {
            let newColor = NSEntityDescription.insertNewObject(forEntityName: "Color", into: viewContext)
            newColor.setValue(colorName, forKey: "colorName")
            newColor.setValue(rgb, forKey: "rgb")
            newColor.setValue(bricklinkId, forKey: "bricklinkId")

            do {
                try viewContext.save()
                showAddColorSheet = false
                resetForm()
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }

    private func updateColor(_ color: NSManagedObject) {
        withAnimation {
            color.setValue(colorName, forKey: "colorName")
            color.setValue(rgb, forKey: "rgb")
            color.setValue(bricklinkId, forKey: "bricklinkId")

            do {
                try viewContext.save()
                showEditColorSheet = false
                resetForm()
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }

    private func deleteColor(_ color: NSManagedObject) {
        withAnimation {
            viewContext.delete(color)

            do {
                try viewContext.save()
            } catch {
                let nsError = error as NSError
                fatalError("Unresolved error \(nsError), \(nsError.userInfo)")
            }
        }
    }

    private func resetForm() {
        colorName = ""
        rgb = ""
        bricklinkId = 0
        selectedColor = nil
    }
}
